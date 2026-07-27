# Bundled Runtime Tools

Skill Studio's Windows x64 desktop packages include the following unmodified portable runtime tools so end users do not need to install Node.js, Git, GitHub CLI, or `npx` separately.

| Tool | Version | License | Official source |
| --- | --- | --- | --- |
| Node.js | 24.18.0 | Node.js license and bundled third-party notices | https://nodejs.org/dist/v24.18.0/ |
| npm | 11.16.0 | Artistic-2.0 | https://github.com/npm/cli/tree/v11.16.0 |
| Git for Windows MinGit | 2.55.0.windows.3 | GPL-2.0-only and component licenses | https://github.com/git-for-windows/git/releases/tag/v2.55.0.windows.3 |
| GitHub CLI | 2.96.0 | MIT | https://github.com/cli/cli/releases/tag/v2.96.0 |
| skills CLI | 1.5.20 | npm metadata declares MIT; bundled dependency notices are included | https://www.npmjs.com/package/skills/v/1.5.20 |
| yaml | Installed dependency of skills CLI | ISC | https://www.npmjs.com/package/yaml |

The complete license files distributed by the official archives remain beside their binaries. Copies of the primary notices are also present in this directory.

## Checksums Of Downloaded Archives

- `node-v24.18.0-win-x64.zip` SHA-256: `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821`
- `MinGit-2.55.0.3-64-bit.zip` SHA-256: `f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05`
- `gh_2.96.0_windows_amd64.zip` SHA-256: `c2d6acc935cd2f00e2144d7e036d5cd82e6b6bd5594e8c75aa75ef2a4ed6aac3`
- `skills-1.5.20.tgz` SHA-1: `01898927e51692d85da779ec1eb8a032bb3b3065`

## Source Availability

Git for Windows is distributed under GPL-2.0-only with separately licensed components. The corresponding release source and build project are available from:

- https://github.com/git-for-windows/git/tree/v2.55.0.windows.3
- https://github.com/git-for-windows/build-extra

Redistributors are responsible for satisfying all corresponding-source and notice obligations for their distribution channel.
