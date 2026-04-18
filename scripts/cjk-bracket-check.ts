import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadHashReport,
  type AutomationBrowserKind,
  type BrowserKind,
} from './browser-automation.ts'

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  browserLineMethod?: 'range' | 'span'
  width?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  firstBreakMismatch?: {
    line: number
    deltaText: string
    reasonGuess: string
    oursText: string
    browserText: string
  } | null
  extractorSensitivity?: string | null
  message?: string
}

type OracleCase = {
  label: string
  text: string
  width: number
  font: string
  lineHeight: number
  lang: string
  dir?: 'ltr' | 'rtl'
  whiteSpace?: 'normal' | 'pre-wrap'
  wordBreak?: 'normal' | 'keep-all'
}

const ORACLE_CASES: OracleCase[] = [
  // CJK + opening bracket segmentation (fix #145)
  // Opening brackets after CJK text must attach to the following text, not the preceding CJK.
  { label: 'A1: Korean parenthesized English', text: '서울(Seoul)과 부산(Busan)', width: 180, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'A2: Japanese parenthesized English', text: '東京(Tokyo)と大阪(Osaka)', width: 180, font: '20px serif', lineHeight: 34, lang: 'ja' },
  { label: 'A3: Chinese parenthesized English', text: '北京(Beijing)和上海(Shanghai)', width: 200, font: '20px serif', lineHeight: 34, lang: 'zh' },
  { label: 'A4: Korean abbreviation bracket', text: '인공지능(AI)과 머신러닝(ML)', width: 200, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'A5: Japanese abbreviation bracket', text: '人工知能(AI)と機械学習(ML)', width: 200, font: '20px serif', lineHeight: 34, lang: 'ja' },
  { label: 'A6: Chinese abbreviation bracket', text: '人工智能(AI)和机器学习(ML)', width: 200, font: '20px serif', lineHeight: 34, lang: 'zh' },
  { label: 'A7: Korean square brackets', text: '참조[1]와 참조[2]를 확인', width: 180, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'A8: Japanese square brackets', text: '参照[1]と参照[2]を確認', width: 180, font: '20px serif', lineHeight: 34, lang: 'ja' },
  { label: 'A9: Korean curly braces', text: '집합{가,나,다}의 원소', width: 180, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'A10: Mixed CJK + nested brackets', text: '한글(日本語(にほんご))테스트', width: 200, font: '20px serif', lineHeight: 34, lang: 'ko' },
]

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseStringFlag(name)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid value for --${name}: ${raw}`)
  return parsed
}

function parseBrowsers(value: string | null): AutomationBrowserKind[] {
  const raw = (value ?? 'chrome,safari').trim()
  if (raw.length === 0) return ['chrome', 'safari']

  const browsers = raw
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)

  for (const browser of browsers) {
    if (browser !== 'chrome' && browser !== 'safari' && browser !== 'firefox') {
      throw new Error(`Unsupported browser ${browser}`)
    }
  }

  return browsers as AutomationBrowserKind[]
}

function buildProbeUrl(baseUrl: string, requestId: string, testCase: OracleCase): string {
  const dir = testCase.dir ?? 'ltr'
  const whiteSpace = testCase.whiteSpace ?? 'normal'
  const wordBreak = testCase.wordBreak ?? 'normal'
  return (
    `${baseUrl}/probe?text=${encodeURIComponent(testCase.text)}` +
    `&width=${testCase.width}` +
    `&font=${encodeURIComponent(testCase.font)}` +
    `&lineHeight=${testCase.lineHeight}` +
    `&dir=${encodeURIComponent(dir)}` +
    `&lang=${encodeURIComponent(testCase.lang)}` +
    `&whiteSpace=${encodeURIComponent(whiteSpace)}` +
    `&wordBreak=${encodeURIComponent(wordBreak)}` +
    `&method=span` +
    `&requestId=${encodeURIComponent(requestId)}`
  )
}

function reportIsExact(report: ProbeReport): boolean {
  return (
    report.status === 'ready' &&
    report.diffPx === 0 &&
    report.predictedLineCount === report.browserLineCount &&
    report.predictedHeight === report.actualHeight &&
    report.firstBreakMismatch === null
  )
}

function printCaseResult(browser: AutomationBrowserKind, testCase: OracleCase, report: ProbeReport): void {
  if (report.status === 'error') {
    console.log(`  FAIL  ${testCase.label}: error: ${report.message ?? 'unknown error'}`)
    return
  }

  const pass = reportIsExact(report)
  const icon = pass ? '✓ PASS' : '✗ FAIL'
  const lines = `[${report.predictedLineCount} lines]`
  const detail = pass
    ? lines
    : `expected=${report.browserLineCount} got=${report.predictedLineCount}  width=${testCase.width}px font=${testCase.font}`

  console.log(`  ${icon}  ${testCase.label.padEnd(40)} ${detail}`)

  if (!pass && report.firstBreakMismatch != null) {
    console.log(
      `         break L${report.firstBreakMismatch.line}: ${report.firstBreakMismatch.reasonGuess} | ` +
      `ours ${JSON.stringify(report.firstBreakMismatch.oursText)} | ` +
      `browser ${JSON.stringify(report.firstBreakMismatch.browserText)}`,
    )
  }
}

async function runBrowser(browser: AutomationBrowserKind, port: number): Promise<boolean> {
  const lock = await acquireBrowserAutomationLock(browser)
  const reportBrowser: BrowserKind | null = browser === 'firefox' ? null : browser
  const session = reportBrowser === null ? null : createBrowserSession(reportBrowser)
  let serverProcess: ChildProcess | null = null
  let ok = true
  let pass = 0

  try {
    if (session === null || reportBrowser === null) {
      throw new Error('Firefox is not supported for korean oracle checks')
    }

    const pageServer = await ensurePageServer(port, '/probe', process.cwd())
    serverProcess = pageServer.process

    console.log(`\nCJK Bracket Check — ${browser.charAt(0).toUpperCase() + browser.slice(1)}`)
    console.log('─'.repeat(60))

    for (const testCase of ORACLE_CASES) {
      const requestId = `${browser}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const url = buildProbeUrl(pageServer.baseUrl, requestId, testCase)
      const report = await loadHashReport<ProbeReport>(session, url, requestId, reportBrowser, timeoutMs)
      printCaseResult(browser, testCase, report)
      if (reportIsExact(report)) {
        pass++
      } else {
        ok = false
      }
    }

    console.log(`\nSummary: ${browser} ${pass}/${ORACLE_CASES.length} pass`)
  } finally {
    session?.close()
    serverProcess?.kill()
    lock.release()
  }

  return ok
}

const requestedPort = parseNumberFlag('port', 0)
const browsers = parseBrowsers(parseStringFlag('browser'))
const timeoutMs = parseNumberFlag('timeout', 60_000)

const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
let overallOk = true
for (const browser of browsers) {
  const browserOk = await runBrowser(browser, port)
  if (!browserOk) overallOk = false
}

if (!overallOk) process.exitCode = 1
