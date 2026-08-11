import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppStore, CategoryId, ImportResult } from '../lib/types'
import type { CategoryInput } from '../lib/categories'
import { syncCategoryRegistry } from '../lib/categories'
import {
  emptyStore,
  importCsvFile,
  importGenericCsv,
  loadStore,
  saveStore,
  setTransactionCategory,
  addManualExpense,
  deleteTransaction,
  deleteImport,
  renameAccount,
  reassignImport,
  addAccountByIban,
  addCategory,
  type GenericImportInput,
  updateCategoryDefinition,
  deleteCategory,
  resetCategories,
  type ManualExpenseInput,
} from '../lib/store'

export function useAppStore() {
  const [store, setStore] = useState<AppStore>(emptyStore)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastImport, setLastImport] = useState<ImportResult | null>(null)
  const skipNextSave = useRef(true)
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    syncCategoryRegistry(store.categories)
  }, [store.categories])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await loadStore()
        if (!cancelled) {
          skipNextSave.current = true
          setStore(loaded)
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'error.loadStore',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading) return
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    let cancelled = false
    ;(async () => {
      setSaving(true)
      try {
        await saveStore(store)
        if (!cancelled) setError(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'error.saveStore')
        }
      } finally {
        if (!cancelled) setSaving(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store, loading])

  const doImport = useCallback(async (file: File) => {
    setError(null)
    try {
      const { store: next, result } = await importCsvFile(
        file,
        storeRef.current,
      )
      setStore(next)
      setLastImport(result)
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error.importFailed'
      setError(msg)
      throw e
    }
  }, [])

  const doImportGeneric = useCallback(async (input: GenericImportInput) => {
    setError(null)
    try {
      const { store: next, result } = importGenericCsv(
        input,
        storeRef.current,
      )
      setStore(next)
      setLastImport(result)
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error.importFailed'
      setError(msg)
      throw e
    }
  }, [])

  const updateCategory = useCallback(
    (
      transactionId: string,
      categoryId: CategoryId,
      createMerchantRule = false,
    ) => {
      setStore((prev) =>
        setTransactionCategory(
          prev,
          transactionId,
          categoryId,
          createMerchantRule,
        ),
      )
    },
    [],
  )

  const addManual = useCallback((input: ManualExpenseInput) => {
    setStore((prev) => addManualExpense(prev, input))
  }, [])

  const removeTransaction = useCallback((transactionId: string) => {
    setStore((prev) => deleteTransaction(prev, transactionId))
  }, [])

  const removeImport = useCallback((importId: string) => {
    setStore((prev) => deleteImport(prev, importId))
  }, [])

  const doRenameAccount = useCallback((accountId: string, name: string) => {
    setStore((prev) => renameAccount(prev, accountId, name))
  }, [])

  const doReassignImport = useCallback(
    (importId: string, accountId: string) => {
      setStore((prev) => reassignImport(prev, importId, accountId))
    },
    [],
  )

  const doAddAccount = useCallback(
    (input: { name: string; iban: string; bank?: string }) => {
      const result = addAccountByIban(storeRef.current, input)
      if (result.error) return result.error
      setStore(result.store)
      return null
    },
    [],
  )

  const applyImportedStore = useCallback((merged: AppStore) => {
    setError(null)
    setStore({ ...merged, isDemo: false })
  }, [])

  const doAddCategory = useCallback((input: CategoryInput) => {
    setStore((prev) => addCategory(prev, input))
  }, [])

  const doUpdateCategoryDefinition = useCallback(
    (categoryId: CategoryId, input: CategoryInput) => {
      setStore((prev) => updateCategoryDefinition(prev, categoryId, input))
    },
    [],
  )

  const doDeleteCategory = useCallback(
    (categoryId: CategoryId, reassignTo?: CategoryId) => {
      setStore((prev) => deleteCategory(prev, categoryId, reassignTo))
    },
    [],
  )

  const doResetCategories = useCallback(() => {
    setStore((prev) => resetCategories(prev))
  }, [])

  return {
    store,
    loading,
    saving,
    error,
    lastImport,
    setLastImport,
    importFile: doImport,
    importGenericFile: doImportGeneric,
    updateCategory,
    addManual,
    removeTransaction,
    removeImport,
    renameAccount: doRenameAccount,
    reassignImport: doReassignImport,
    addAccount: doAddAccount,
    applyImportedStore,
    addCategory: doAddCategory,
    updateCategoryDefinition: doUpdateCategoryDefinition,
    deleteCategory: doDeleteCategory,
    resetCategories: doResetCategories,
  }
}
