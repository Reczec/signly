import { cp, mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDirectory = fileURLToPath(new URL('../', import.meta.url))
const packageDirectory = join(appDirectory, 'node_modules', '@mediapipe', 'tasks-vision')
const wasmSource = join(packageDirectory, 'wasm')
const wasmDestination = join(appDirectory, 'public', 'wasm')
const modelPath = join(appDirectory, 'public', 'models', 'hand_landmarker.task')
const expectedVersion = '0.10.35'
const expectedModelBytes = 7_819_105
const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

async function copyAssets(): Promise<void> {
  let installedVersion: unknown
  try {
    const manifest = JSON.parse(
      await readFile(join(packageDirectory, 'package.json'), 'utf8'),
    ) as { version?: unknown }
    installedVersion = manifest.version
  } catch (cause) {
    throw new Error(
      `Cannot read the installed @mediapipe/tasks-vision package. Run npm.cmd ci from ${appDirectory}, then rerun npm.cmd run assets.`,
      { cause },
    )
  }

  if (installedVersion !== expectedVersion) {
    throw new Error(
      `Expected @mediapipe/tasks-vision ${expectedVersion}, found ${String(installedVersion)}. Restore the locked dependencies with npm.cmd ci before copying assets.`,
    )
  }

  let sourceIsDirectory = false
  try {
    sourceIsDirectory = (await stat(wasmSource)).isDirectory()
  } catch (cause) {
    throw new Error(
      `The installed MediaPipe WASM directory is missing or unreadable: ${wasmSource}. Run npm.cmd ci to restore the package.`,
      { cause },
    )
  }
  if (!sourceIsDirectory) {
    throw new Error(`Expected a MediaPipe WASM directory at ${wasmSource}. Run npm.cmd ci to restore the package.`)
  }

  await mkdir(wasmDestination, { recursive: true })
  await cp(wasmSource, wasmDestination, { recursive: true, force: true })
  console.log(`Copied MediaPipe ${expectedVersion} WASM assets locally to ${wasmDestination}.`)

  let modelBytes: number
  try {
    modelBytes = (await stat(modelPath)).size
  } catch {
    console.warn(
      `WARNING: Hand Landmarker model is missing or unreadable at ${modelPath}. Download ${modelUrl} once to that path (${expectedModelBytes.toLocaleString('en-US')} bytes). See public/models/README.md. This script does not download files.`,
    )
    return
  }
  if (modelBytes !== expectedModelBytes) {
    console.warn(
      `WARNING: Hand Landmarker model has ${modelBytes.toLocaleString('en-US')} bytes; expected ${expectedModelBytes.toLocaleString('en-US')}. Replace ${modelPath} with the complete model from ${modelUrl} before using the camera. See public/models/README.md.`,
    )
    return
  }
  console.log(`Hand Landmarker model byte count matches (${expectedModelBytes.toLocaleString('en-US')} bytes). This is a size check, not a checksum verification.`)
}

copyAssets().catch((error: unknown) => {
  console.error(`Asset setup failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
