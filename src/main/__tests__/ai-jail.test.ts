/**
 * ai-jail integration — pure logic + detection, runs in Node.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import {
  assetFor,
  parseSha256,
  wrapCommand,
  winToWslPath,
  wslJailArgv,
  looksLikeSandboxBlock,
  looksLikeUserNsBlock,
  sandboxSmokeTest,
  APPARMOR_USERNS_REASON,
  parseVersion,
  candidatePaths,
  detectAiJail,
  installAiJail,
  AI_JAIL_VERSION,
  type Exec
} from '../ai-jail'

describe('assetFor', () => {
  it('maps the two published binaries', () => {
    expect(assetFor('linux', 'x64')?.file).toBe('ai-jail-linux-x86_64.tar.gz')
    expect(assetFor('darwin', 'arm64')?.file).toBe('ai-jail-macos-aarch64.tar.gz')
  })

  it('has no binary for Windows or Intel macOS (they use WSL2 / brew)', () => {
    expect(assetFor('win32', 'x64')).toBeNull()
    expect(assetFor('darwin', 'x64')).toBeNull()
    expect(assetFor('linux', 'arm64')).toBeNull()
  })

  it('points the url and the sha sidecar at the pinned release', () => {
    const a = assetFor('linux', 'x64')!
    expect(a.url).toContain(`/${AI_JAIL_VERSION}/ai-jail-linux-x86_64.tar.gz`)
    expect(a.shaUrl).toBe(`${a.url}.sha256`)
  })
})

describe('parseSha256', () => {
  it('reads the digest out of a sidecar line', () => {
    const hex = 'a'.repeat(64)
    expect(parseSha256(`${hex}  ai-jail-linux-x86_64.tar.gz\n`)).toBe(hex)
  })
  it('returns null when there is no digest', () => {
    expect(parseSha256('not a checksum')).toBeNull()
  })
})

describe('wrapCommand', () => {
  it('confines to the project dir with --rw-map and an inner sh', () => {
    const w = wrapCommand('/home/u/.local/bin/ai-jail', '/proj', 'npm test')
    expect(w).toBe("'/home/u/.local/bin/ai-jail' --rw-map '/proj' -- /bin/sh -c 'npm test'")
  })

  it('escapes embedded single quotes so the command survives the shell', () => {
    const w = wrapCommand('/bin/ai-jail', '/p', `echo 'hi'`)
    // The inner command still round-trips through the nested sh -c.
    expect(w).toContain(`-c 'echo '\\''hi'\\'''`)
  })

  it('uses the absolute binary path (PATH may miss ~/.local/bin)', () => {
    expect(wrapCommand('/opt/homebrew/bin/ai-jail', '/p', 'ls')).toContain("'/opt/homebrew/bin/ai-jail'")
  })
})

describe('winToWslPath', () => {
  it('maps a Windows drive path to the /mnt view', () => {
    expect(winToWslPath('C:\\Users\\x\\proj')).toBe('/mnt/c/Users/x/proj')
    expect(winToWslPath('D:/a/b')).toBe('/mnt/d/a/b')
  })
  it('leaves a POSIX-ish path alone (just normalises slashes)', () => {
    expect(winToWslPath('/home/u/p')).toBe('/home/u/p')
  })
})

describe('wslJailArgv', () => {
  it('builds argv running the command sandboxed inside WSL, cwd at the project', () => {
    const argv = wslJailArgv('/home/u/.local/bin/ai-jail', 'C:\\proj', 'npm test')
    expect(argv).toEqual([
      '-e',
      '/home/u/.local/bin/ai-jail',
      '--rw-map',
      '/mnt/c/proj',
      '--',
      'bash',
      '-c',
      "cd '/mnt/c/proj' && npm test"
    ])
  })
})

describe('looksLikeSandboxBlock', () => {
  it('recognises ai-jail / bwrap markers', () => {
    expect(looksLikeSandboxBlock('bwrap: Operation not permitted')).toBe(true)
    expect(looksLikeSandboxBlock('denied by sandbox')).toBe(true)
  })
  it('does not claim an ordinary permission error as a block', () => {
    expect(looksLikeSandboxBlock('cat: /etc/foo: Permission denied')).toBe(false)
  })
})

describe('looksLikeUserNsBlock', () => {
  it('recognises the restricted-user-namespaces failure', () => {
    expect(looksLikeUserNsBlock('bwrap: setting up uid map: Permission denied')).toBe(true)
    expect(looksLikeUserNsBlock('bwrap: Creating new namespace failed: Operation not permitted')).toBe(true)
    expect(looksLikeUserNsBlock('bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted')).toBe(true)
  })
  it('does not claim a plain error, nor a sandbox that denied a file, as the userns block', () => {
    expect(looksLikeUserNsBlock('cat: /etc/foo: Permission denied')).toBe(false) // no bwrap: marker
    expect(looksLikeUserNsBlock('bwrap: execvp npm: No such file or directory')).toBe(false)
  })
})

describe('sandboxSmokeTest', () => {
  it('runs a no-op through ai-jail and passes when it exits 0', async () => {
    const exec: Exec = vi.fn(async (cmd, args) => {
      expect(cmd).toBe('/bin/ai-jail')
      expect(args).toContain('--rw-map')
      expect(args.slice(-3)).toEqual(['/bin/sh', '-c', 'true'])
      return { code: 0, stdout: '', stderr: '' }
    })
    expect(await sandboxSmokeTest(exec, '/bin/ai-jail')).toEqual({ ok: true })
  })

  it('flags the AppArmor/userns block with the sysctl fix', async () => {
    const exec: Exec = async () => ({
      code: 1,
      stdout: '',
      stderr: 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted'
    })
    const r = await sandboxSmokeTest(exec, '/bin/ai-jail')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe(APPARMOR_USERNS_REASON)
    expect(r.reason).toMatch(/apparmor_restrict_unprivileged_userns=0/)
  })

  it('reports a generic failure (with detail) for a non-namespace error', async () => {
    const exec: Exec = async () => ({ code: 2, stdout: '', stderr: 'ai-jail: unknown flag' })
    const r = await sandboxSmokeTest(exec, '/bin/ai-jail')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/código 2/)
    expect(r.reason).toMatch(/unknown flag/)
  })
})

describe('parseVersion / candidatePaths', () => {
  it('pulls a semver out of --version output', () => {
    expect(parseVersion('ai-jail 1.15.0')).toBe('1.15.0')
    expect(parseVersion('no version here')).toBeNull()
  })
  it('tries PATH first, then the dirs a GUI app misses', () => {
    const c = candidatePaths().map((p) => p.replace(/\\/g, '/'))
    expect(c[0]).toBe('ai-jail')
    expect(c.some((p) => p.endsWith('/.local/bin/ai-jail'))).toBe(true)
  })
})

describe('detectAiJail', () => {
  it('reports available with the version and the path that answered', async () => {
    if (process.platform === 'win32') return // native PATH lookup is Linux/macOS only
    // Only the bare-name PATH candidate answers.
    const exec: Exec = vi.fn(async (cmd, args) => {
      if (cmd === 'ai-jail' && args[0] === '--version') return { code: 0, stdout: 'ai-jail 1.15.0', stderr: '' }
      return { code: 1, stdout: '', stderr: 'not found' }
    })
    const s = await detectAiJail(exec)
    expect(s.available).toBe(true)
    expect(s.version).toBe('1.15.0')
    expect(s.path).toBe('ai-jail')
  })

  it('reports unavailable when nothing answers', async () => {
    const exec: Exec = async () => ({ code: 127, stdout: '', stderr: 'not found' })
    const s = await detectAiJail(exec)
    expect(s.available).toBe(false)
    expect(s.path).toBeNull()
  })

  it('stays available on Linux when ai-jail, bwrap and the sandbox smoke test all pass', async () => {
    if (process.platform !== 'linux') return // the smoke test runs in the Linux branch only
    const exec: Exec = async (cmd, args) => {
      if (cmd === 'ai-jail' && args[0] === '--version') return { code: 0, stdout: 'ai-jail 1.15.0', stderr: '' }
      if (args.join(' ').includes('command -v bwrap')) return { code: 0, stdout: '/usr/bin/bwrap', stderr: '' }
      if (args.includes('--rw-map')) return { code: 0, stdout: '', stderr: '' } // smoke test no-op
      return { code: 1, stdout: '', stderr: '' }
    }
    const s = await detectAiJail(exec)
    expect(s.available).toBe(true)
    expect(s.bubblewrap).toBe(true)
    expect(s.reason).toBeUndefined()
  })

  it('flips available off on Linux when the sandbox can not start (AppArmor userns block)', async () => {
    if (process.platform !== 'linux') return
    const exec: Exec = async (cmd, args) => {
      if (cmd === 'ai-jail' && args[0] === '--version') return { code: 0, stdout: 'ai-jail 1.15.0', stderr: '' }
      if (args.join(' ').includes('command -v bwrap')) return { code: 0, stdout: '/usr/bin/bwrap', stderr: '' }
      if (args.includes('--rw-map'))
        return { code: 1, stdout: '', stderr: 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' }
      return { code: 1, stdout: '', stderr: '' }
    }
    const s = await detectAiJail(exec)
    expect(s.available).toBe(false)
    expect(s.bubblewrap).toBe(true) // bwrap IS installed; it just can't create the namespace
    expect(s.reason).toMatch(/apparmor_restrict_unprivileged_userns=0/)
  })

  it('finds ai-jail INSIDE WSL on Windows (viaWsl, WSL path)', async () => {
    if (process.platform !== 'win32') return // this branch is platform-gated
    // Ordered specific-first: `-lc` in the bash calls also contains `-l`, so the
    // list check has to be the `-l -v` one and come after the script matches.
    const exec: Exec = async (cmd, args) => {
      const a = args.join(' ')
      if (cmd === 'wsl' && a.includes('command -v ai-jail'))
        return { code: 0, stdout: '/home/u/.local/bin/ai-jail\nai-jail 1.15.0', stderr: '' }
      if (cmd === 'wsl' && a.includes('command -v bwrap')) return { code: 0, stdout: '/usr/bin/bwrap', stderr: '' }
      if (cmd === 'wsl' && a.includes('-l -v')) return { code: 0, stdout: 'Ubuntu Running 2', stderr: '' }
      return { code: 1, stdout: '', stderr: '' }
    }
    const s = await detectAiJail(exec)
    expect(s.available).toBe(true)
    expect(s.viaWsl).toBe(true)
    expect(s.wsl2).toBe(true)
    expect(s.path).toBe('/home/u/.local/bin/ai-jail')
    expect(s.version).toBe('1.15.0')
  })
})

describe('installAiJail', () => {
  it('refuses on Windows, directing to WSL2', async () => {
    if (process.platform !== 'win32') return // the branch is platform-gated
    const res = await installAiJail(
      { exec: async () => ({ code: 1, stdout: '', stderr: '' }), download: async () => 0, fetchText: async () => '' },
      () => {}
    )
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/WSL2/i)
  })
})
