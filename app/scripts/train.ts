import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { buildKnnModel } from '../src/recognition/classifier'
import { parseSamplesDataset } from '../src/recognition/dataset'
import { PREPROCESSING_VERSION } from '../src/recognition/features'

const appDirectory = fileURLToPath(new URL('../', import.meta.url))
const DEFAULT_INPUT = 'data/samples.json'
const DEFAULT_OUTPUT = 'public/models/asl-knn-v1.json'
const TRAIN_LABELS = ['A', 'B', 'C']
const MIN_HOLDS_PER_LABEL = 3
const RECOMMENDED_HOLDS_PER_LABEL = 6

interface CliOptions {
  input: string
  output: string
}

function usage(): string {
  return 'Usage: npm.cmd run train -- [--input data/samples.json] [--output public/models/asl-knn-v1.json]'
}

function parseArgs(argv: string[]): CliOptions {
  let input = DEFAULT_INPUT
  let output = DEFAULT_OUTPUT
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--input' || argument === '--output') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}. ${usage()}`)
      }
      index += 1
      if (argument === '--input') input = value
      else output = value
      continue
    }
    throw new Error(`Unknown argument "${argument}". ${usage()}`)
  }
  return { input, output }
}

function resolveFromApp(path: string): string {
  return isAbsolute(path) ? path : resolve(appDirectory, path)
}

async function train(options: CliOptions): Promise<void> {
  const startedAt = performance.now()
  const inputPath = resolveFromApp(options.input)
  const outputPath = resolveFromApp(options.output)

  let raw: string
  try {
    raw = await readFile(inputPath, 'utf8')
  } catch (cause) {
    throw new Error(
      `Cannot read ${inputPath}. Export samples.json from the collector into app/data/ first.`,
      { cause },
    )
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`${inputPath} is not valid JSON.`, { cause })
  }

  const dataset = parseSamplesDataset(json)
  if (dataset.preprocessingVersion !== PREPROCESSING_VERSION) {
    throw new Error(
      `Dataset preprocessingVersion ${dataset.preprocessingVersion} does not match the current ${PREPROCESSING_VERSION}. Re-export the samples with the current collector.`,
    )
  }

  const model = buildKnnModel(dataset, {
    labels: TRAIN_LABELS,
    enabledLabels: TRAIN_LABELS,
    minHoldsPerLabel: MIN_HOLDS_PER_LABEL,
  })

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8')

  const elapsed = Math.round(performance.now() - startedAt)
  console.log(`Trained provisional A/B/C model in ${elapsed} ms -> ${outputPath}`)
  console.log(
    `Training data: ${model.training.frames} frames in ${model.training.holds} independent holds (split "${model.training.split}").`,
  )
  for (const label of model.labels) {
    const stats = model.training.perLabel[label]
    console.log(
      `  ${label}: ${stats.holds} holds, ${stats.frames} frames, radius ${model.radii[label].toFixed(4)}`,
    )
  }
  console.log(`Enabled letters: ${model.enabledLabels.join(', ')} (hackathon MVP).`)
  const belowRecommended = model.labels.filter(
    (label) => model.training.perLabel[label].holds < RECOMMENDED_HOLDS_PER_LABEL,
  )
  if (belowRecommended.length > 0) {
    console.log(
      `Recommendation: collect ${RECOMMENDED_HOLDS_PER_LABEL} or more independent holds per letter for reliable live results (long-term plan: 12 holds per letter in two sessions). Below that right now: ${belowRecommended.join(', ')}.`,
    )
  } else {
    console.log(
      `Every letter has at least ${RECOMMENDED_HOLDS_PER_LABEL} independent holds. The long-term plan still asks for 12 holds per letter across two sessions.`,
    )
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  await train(options)
}

main().catch((error: unknown) => {
  console.error(`Training failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
