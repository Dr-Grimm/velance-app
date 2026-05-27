/**
 * afterPack hook — embeds the Velance icon into Velance.exe after packaging.
 *
 * electron-builder's `signAndEditExecutable: false` disables BOTH code-signing
 * AND icon embedding (rcedit). We keep that flag so the winCodeSign package is
 * never downloaded (it contains macOS dylib symlinks that fail on Windows
 * without Developer Mode). Instead, we call rcedit.exe ourselves here,
 * after the app is packed but before the NSIS installer is assembled.
 */

const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

exports.default = async function afterPack(context) {
  // Only run on Windows builds
  if (context.electronPlatformName !== 'win32') return

  const exePath = path.join(context.appOutDir, 'Velance.exe')
  const iconPath = path.resolve(__dirname, '..', 'build', 'icon.ico')

  // Locate the rcedit binary that ships with the rcedit npm package
  const rceditExe = path.resolve(
    __dirname,
    '..',
    'node_modules',
    'rcedit',
    'bin',
    process.arch === 'x64' ? 'rcedit-x64.exe' : 'rcedit.exe',
  )

  if (!fs.existsSync(rceditExe)) {
    console.warn(`  ⚠ afterPack: rcedit not found at ${rceditExe} — icon NOT embedded`)
    return
  }

  if (!fs.existsSync(iconPath)) {
    console.warn(`  ⚠ afterPack: icon not found at ${iconPath} — icon NOT embedded`)
    return
  }

  if (!fs.existsSync(exePath)) {
    console.warn(`  ⚠ afterPack: Velance.exe not found at ${exePath} — icon NOT embedded`)
    return
  }

  console.log(`  • afterPack: embedding icon into ${exePath}`)

  await execFileAsync(rceditExe, [exePath, '--set-icon', iconPath])

  console.log('  • afterPack: icon embedded successfully ✓')
}
