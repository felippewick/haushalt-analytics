import { useMemo, useState } from 'react'
import type { Category, CategoryId } from '../lib/types'
import {
  CATEGORY_COLOR_PRESETS,
  canDeleteCategory,
  categoriesEqual,
  categoryKind,
  cloneDefaultCategories,
  isBuiltinCategory,
  type CategoryInput,
  type CategoryKind,
} from '../lib/categories'
import { categoryLabel as i18nCategoryLabel } from '../lib/i18n'
import { useLocale } from '../hooks/useLocale'
import { CategoryIcon } from './CategoryIcon'

interface Props {
  categories: Category[]
  onAdd: (input: CategoryInput) => void
  onUpdate: (categoryId: CategoryId, input: CategoryInput) => void
  onDelete: (categoryId: CategoryId) => void
  onReset: () => void
}

type EditorMode = { type: 'idle' } | { type: 'add' } | { type: 'edit'; id: CategoryId }

export function CategoryManager({
  categories,
  onAdd,
  onUpdate,
  onDelete,
  onReset,
}: Props) {
  const { t, categoryLabel, locale } = useLocale()
  const [mode, setMode] = useState<EditorMode>({ type: 'idle' })
  const [confirmDeleteId, setConfirmDeleteId] = useState<CategoryId | null>(
    null,
  )
  const [confirmReset, setConfirmReset] = useState(false)

  const isDefault = useMemo(
    () => categoriesEqual(categories, cloneDefaultCategories()),
    [categories],
  )

  const editing = mode.type === 'edit'
    ? categories.find((c) => c.id === mode.id)
    : null

  return (
    <div className="category-manager">
      <p className="muted settings-intro">{t('settings.categories.detail')}</p>

      {mode.type === 'idle' ? (
        <>
          <ul className="category-manager-list">
            {categories.map((cat) => {
              const kind = categoryKind(cat)
              const kindLabel =
                kind === 'income'
                  ? t('settings.categories.kind.income')
                  : kind === 'excluded'
                    ? t('settings.categories.kind.excluded')
                    : t('settings.categories.kind.expense')
              return (
                <li key={cat.id} className="category-manager-row">
                  <div className="category-manager-row-main">
                    <CategoryIcon categoryId={cat.id} badge size={14} />
                    <div className="category-manager-row-text">
                      <span className="category-manager-name">
                        {categoryLabel(cat.id)}
                      </span>
                      <span className="muted small">
                        {kindLabel}
                        {!isBuiltinCategory(cat.id)
                          ? ` · ${t('settings.categories.custom')}`
                          : cat.labelOverride
                            ? ` · ${t('settings.categories.renamed')}`
                            : ''}
                      </span>
                    </div>
                  </div>
                  <div className="category-manager-row-actions">
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setMode({ type: 'edit', id: cat.id })}
                    >
                      {t('settings.categories.edit')}
                    </button>
                    {canDeleteCategory(cat.id) && (
                      <button
                        type="button"
                        className="linkish danger"
                        onClick={() => setConfirmDeleteId(cat.id)}
                      >
                        {t('settings.categories.delete')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {confirmDeleteId && (
            <div className="category-manager-confirm card">
              <p>
                {t('settings.categories.deleteConfirm', {
                  name: categoryLabel(confirmDeleteId),
                })}
              </p>
              <div className="category-manager-form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmDeleteId(null)}
                >
                  {t('settings.cancel')}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onDelete(confirmDeleteId)
                    setConfirmDeleteId(null)
                  }}
                >
                  {t('settings.categories.delete')}
                </button>
              </div>
            </div>
          )}

          {confirmReset && (
            <div className="category-manager-confirm card">
              <p>{t('settings.categories.resetConfirm')}</p>
              <div className="category-manager-form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmReset(false)}
                >
                  {t('settings.cancel')}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onReset()
                    setConfirmReset(false)
                  }}
                >
                  {t('settings.categories.reset')}
                </button>
              </div>
            </div>
          )}

          <div className="category-manager-toolbar">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setMode({ type: 'add' })}
            >
              {t('settings.categories.add')}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isDefault}
              onClick={() => setConfirmReset(true)}
            >
              {t('settings.categories.reset')}
            </button>
          </div>
        </>
      ) : (
        <CategoryForm
          key={mode.type === 'edit' ? mode.id : 'add'}
          initial={
            editing
              ? {
                  label: categoryLabel(editing.id),
                  color: editing.color,
                  kind: categoryKind(editing),
                }
              : {
                  label: '',
                  color: CATEGORY_COLOR_PRESETS[0],
                  kind: 'expense',
                }
          }
          isBuiltin={editing ? isBuiltinCategory(editing.id) : false}
          title={
            mode.type === 'add'
              ? t('settings.categories.addTitle')
              : t('settings.categories.editTitle')
          }
          submitLabel={
            mode.type === 'add'
              ? t('settings.categories.create')
              : t('settings.categories.save')
          }
          onCancel={() => setMode({ type: 'idle' })}
          onSubmit={(input) => {
            if (mode.type === 'add') {
              onAdd(input)
            } else {
              const builtin = isBuiltinCategory(mode.id)
              const defaultName = i18nCategoryLabel(mode.id, locale)
              onUpdate(mode.id, {
                ...input,
                labelOverride: builtin
                  ? input.label === defaultName
                    ? ''
                    : input.label
                  : undefined,
              })
            }
            setMode({ type: 'idle' })
          }}
          localeHint={
            editing && isBuiltinCategory(editing.id)
              ? t('settings.categories.builtinNameHint')
              : undefined
          }
        />
      )}
    </div>
  )
}

function CategoryForm({
  initial,
  isBuiltin,
  title,
  submitLabel,
  onCancel,
  onSubmit,
  localeHint,
}: {
  initial: { label: string; color: string; kind: CategoryKind }
  isBuiltin: boolean
  title: string
  submitLabel: string
  onCancel: () => void
  onSubmit: (input: CategoryInput) => void
  localeHint?: string
}) {
  const { t } = useLocale()
  const [label, setLabel] = useState(initial.label)
  const [color, setColor] = useState(initial.color)
  const [kind, setKind] = useState<CategoryKind>(initial.kind)

  return (
    <form
      className="category-manager-form"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = label.trim()
        if (!trimmed) return
        onSubmit({ label: trimmed, color, kind })
      }}
    >
      <h3 className="category-manager-form-title">{title}</h3>
      {localeHint && <p className="muted small">{localeHint}</p>}

      <label className="manual-field">
        <span>{t('settings.categories.name')}</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          maxLength={60}
        />
      </label>

      <fieldset className="settings-options">
        <legend className="settings-options-legend">
          {t('settings.categories.kind')}
        </legend>
        {(
          [
            ['expense', 'settings.categories.kind.expense'],
            ['income', 'settings.categories.kind.income'],
            ['excluded', 'settings.categories.kind.excluded'],
          ] as const
        ).map(([id, key]) => (
          <label key={id} className="settings-option">
            <input
              type="radio"
              name="category-kind"
              value={id}
              checked={kind === id}
              onChange={() => setKind(id)}
            />
            <span>
              <strong>{t(key)}</strong>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="category-manager-colors">
        <span className="manual-field-label">
          {t('settings.categories.color')}
        </span>
        <div className="category-manager-swatches" role="listbox">
          {CATEGORY_COLOR_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              role="option"
              aria-selected={color === preset}
              className={`category-swatch ${color === preset ? 'selected' : ''}`}
              style={{ background: preset }}
              onClick={() => setColor(preset)}
              title={preset}
            />
          ))}
        </div>
        <label className="category-manager-color-custom">
          <span className="muted small">{t('settings.categories.customColor')}</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
      </div>

      {isBuiltin && (
        <p className="privacy-note">{t('settings.categories.builtinEditNote')}</p>
      )}

      <div className="category-manager-form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('settings.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={!label.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
