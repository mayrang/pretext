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
  // B: Edge cases — normal mode
  {
    label: 'B1: 한글 자모 단독 (U+1100)',
    text: 'ᄀᄂᄃ 테스트 ᄀᄂᄃ 테스트 ᄀᄂᄃ',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2: 한글 호환 자모 (U+3130)',
    text: 'ㄱㄴㄷ 호환 자모 ㄱㄴㄷ 호환 자모 ㄱㄴㄷ',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B3: 한글+영어 혼합',
    text: '안녕 Hello 세계 안녕 Hello 세계',
    width: 200,
    font: '20px "Apple SD Gothic Neo"',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B4: 한글+숫자',
    text: '가격은 10,000원 입니다 배송은 3,500원 입니다',
    width: 200,
    font: '20px "Apple SD Gothic Neo"',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B5: 한글+CJK 구두점',
    text: '안녕하세요。잘 부탁합니다。감사합니다。',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B6: NBSP + 한글',
    text: '서울\u00A0시청역 부산\u00A0역',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  // B2-width-variants: same texts at different widths to confirm bug is width-sensitive
  {
    label: 'B2c-w160: ㅠㅠ 감정 (160px)',
    text: 'ㅠㅠ 너무 슬퍼요 ㅠㅠ 정말로',
    width: 160,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2c-w140: ㅠㅠ 감정 (140px)',
    text: 'ㅠㅠ 너무 슬퍼요 ㅠㅠ 정말로',
    width: 140,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2d-w150: ㄹㅇ 슬랭 (150px)',
    text: '이거 ㄹㅇ임 ㄹㅇ 아니면 뭐야',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2f-w150: ㅇㅋ ㄴㄴ (150px)',
    text: 'ㅇㅋ 알겠어요 ㄴㄴ 그건 아니고',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  // B2-variants: Hangul Compatibility Jamo edge cases (the confirmed bug)
  {
    label: 'B2b: ㅋㅋ 슬랭 혼합',
    text: 'ㅋㅋㅋ 진짜 웃기다 ㅋㅋㅋ 진짜로',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2c: ㅠㅠ 감정 표현',
    text: 'ㅠㅠ 너무 슬퍼요 ㅠㅠ 정말로',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2d: 자음 단독 문장 중간',
    text: '이거 ㄹㅇ임 ㄹㅇ 아니면 뭐야',
    width: 180,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2e: 자음만 연속',
    text: 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2f: ㅇㅋ ㄴㄴ 인터넷 슬랭',
    text: 'ㅇㅋ 알겠어요 ㄴㄴ 그건 아니고',
    width: 180,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  // C: Layout modes
  {
    label: 'C1: keep-all + 좁은 너비',
    text: '한국어 테스트 입니다',
    width: 80,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
    wordBreak: 'keep-all',
  },
  {
    label: 'C2: keep-all + 한글+영어 혼합',
    text: '한국어 Korean 혼합 테스트',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
    wordBreak: 'keep-all',
  },
  {
    label: 'C3: pre-wrap + 한글 하드 브레이크',
    text: '가나다\n라마바',
    width: 300,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
    whiteSpace: 'pre-wrap',
  },
  {
    label: 'C4: pre-wrap + 탭 + 한글',
    text: '가나\t다라',
    width: 300,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
    whiteSpace: 'pre-wrap',
  },
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

    console.log(`\nKorean Layout Check — ${browser.charAt(0).toUpperCase() + browser.slice(1)}`)
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
