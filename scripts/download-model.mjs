#!/usr/bin/env node
/**
 * Downloads the bundled local LLM (GGUF) used for auto-categorization.
 * Skips download when the file already exists and matches the expected size.
 *
 * Model: Qwen2.5-0.5B-Instruct Q4_K_M (~380 MB, well under 1 GB).
 */
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

export const MODEL_FILE = 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'
export const MODEL_DIR = join(ROOT, 'src-tauri', 'resources', 'models')
export const MODEL_PATH = join(MODEL_DIR, MODEL_FILE)
/** Exact size from Hugging Face (bytes). */
export const EXPECTED_BYTES = 397_808_192
const MODEL_URL =
  'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function download() {
  mkdirSync(MODEL_DIR, { recursive: true })

  if (existsSync(MODEL_PATH)) {
    const size = statSync(MODEL_PATH).size
    if (size === EXPECTED_BYTES) {
      console.log(`Model already present (${formatMb(size)}): ${MODEL_PATH}`)
      return
    }
    console.warn(
      `Model size mismatch (${formatMb(size)} vs ${formatMb(EXPECTED_BYTES)}); re-downloading.`,
    )
    unlinkSync(MODEL_PATH)
  }

  console.log(`Downloading ${MODEL_FILE} (${formatMb(EXPECTED_BYTES)})…`)
  const res = await fetch(MODEL_URL, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`)
  }

  const tmp = `${MODEL_PATH}.partial`
  try {
    await pipeline(res.body, createWriteStream(tmp))
    const size = statSync(tmp).size
    if (size !== EXPECTED_BYTES) {
      throw new Error(
        `Downloaded size ${size} does not match expected ${EXPECTED_BYTES}`,
      )
    }
    const { renameSync } = await import('node:fs')
    renameSync(tmp, MODEL_PATH)
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp)
    throw err
  }

  console.log(`Saved ${formatMb(EXPECTED_BYTES)} → ${MODEL_PATH}`)
}

download().catch((err) => {
  console.error(err)
  process.exit(1)
})
