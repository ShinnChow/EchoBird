import type { TerminalSegment } from '../../api/routerTerminal';

const pick = <T>(values: T[]) => values[Math.floor(Math.random() * values.length)];
const hex = (length: number) =>
  Array.from({ length }, () => pick('0123456789abcdef'.split(''))).join('');

// Fictional display data only. These rows never enter the router or statistics APIs.
export function terminalDemoRow(): TerminalSegment[] {
  const segments: TerminalSegment[] = [];
  const plain = (text: string) => ({ text, protectedText: null, kind: null });
  const values = [
    ['DemoPass!2026', 2],
    [`sk-demo-${hex(22)}`, 0],
    [`demo_access_${hex(12)}`, 1],
    ['DemoDB@5432', 2],
    [`demo-private-${hex(32)}`, 3],
  ] as const;
  const labels = ['api_key = ', 'token = ', 'password = ', 'private_key = '];
  for (let i = 0, count = pick([1, 2, 2, 3, 4, 5]); i < count; i++) {
    if (Math.random() < 0.28) {
      const [text, kind] = values[Math.floor(Math.random() * values.length)];
      segments.push(
        plain(labels[kind]),
        {
          text,
          protectedText: `{{DEMO_${hex(4).toUpperCase()}}}`,
          kind,
        },
        plain(' ')
      );
    } else {
      segments.push(
        plain(
          pick([
            '[+] messages/user → inspect ',
            `request.body ${hex(12)} `,
            '[+] context.window merge role=user ',
            `buffer.flush ${Math.floor(Math.random() * 8192)} bytes `,
            'router@local:~# forward --stream ',
            `[+] stream.write seq=${Math.floor(Math.random() * 12000)} utf8 `,
            '[+] local processing complete ',
            `payload.chunk ${hex(6)} → upstream `,
            'context.attach /workspace/demo/src/settings.ts ',
          ])
        )
      );
    }
  }
  return segments;
}
