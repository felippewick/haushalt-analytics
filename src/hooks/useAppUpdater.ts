import { isTauri } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'upToDate'
  | 'downloading'
  | 'restarting'
  | 'dev'
  | 'error'

export function useAppUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>('idle')
  const [currentVersion, setCurrentVersion] = useState('')
  const [availableVersion, setAvailableVersion] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState(0)
  const [contentLength, setContentLength] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const pendingRef = useRef<Update | null>(null)

  const enabled = isTauri()

  const checkForUpdate = useCallback(async () => {
    if (!isTauri()) return
    if (import.meta.env.DEV) {
      setStatus('dev')
      return
    }

    setError(null)
    setStatus('checking')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) {
        pendingRef.current = update
        setAvailableVersion(update.version)
        setBannerDismissed(false)
        setStatus('available')
      } else {
        pendingRef.current = null
        setAvailableVersion(null)
        setStatus('upToDate')
      }
    } catch (e) {
      pendingRef.current = null
      setAvailableVersion(null)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [])

  const installAndRelaunch = useCallback(async () => {
    const update = pendingRef.current
    if (!update) return

    setError(null)
    setDownloaded(0)
    setContentLength(null)
    setStatus('downloading')
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setContentLength(event.data.contentLength ?? null)
          setDownloaded(0)
        } else if (event.event === 'Progress') {
          setDownloaded((n) => n + event.data.chunkLength)
        }
      })
      setStatus('restarting')
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    void import('@tauri-apps/api/app').then(({ getVersion }) =>
      getVersion().then(setCurrentVersion),
    )
    void checkForUpdate()
  }, [checkForUpdate])

  const progressPercent =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null

  return {
    enabled,
    status,
    currentVersion,
    availableVersion,
    progressPercent,
    error,
    showBanner:
      (status === 'available' ||
        status === 'downloading' ||
        status === 'restarting') &&
      !bannerDismissed,
    dismissBanner: () => setBannerDismissed(true),
    checkForUpdate,
    installAndRelaunch,
  }
}

export type AppUpdater = ReturnType<typeof useAppUpdater>
