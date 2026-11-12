import { formatAmountInput, parseDecimalInput } from '@sagyou/core/finance'
import { addItem, updateItem, type ItemUpdates } from '@sagyou/core/finance-actions'
import { D } from '@sagyou/core/money'
import type { FinancialTable, ShoppingItem } from '@sagyou/core/types'
import { useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { Button } from '../../components/Button'
import { Field } from '../../components/Field'
import { closeOrConfirm } from '../../components/discard'
import { useApp } from '../../store/app'
import {
  INVALID_AMOUNT_TEXT,
  applyFinance,
  parseAmount,
  type FinanceOutcome
} from '../../store/finance'

export const INVALID_QTY_TEXT = 'Quantidade inválida.'

export interface ItemSheetProps {
  visible: boolean
  onClose: () => void
  table: FinancialTable
  /** Editing this item; without it the sheet creates one. */
  item?: ShoppingItem
}

/** The quantity as the field shows it (a comma for the fraction, so it parses back to the same number). */
const qtyText = (qty: number): string => String(qty).replace('.', ',')

/** Novo item or Editar item: name, quantity, price per unit (optional, table currency) and link. */
export function ItemSheet(props: ItemSheetProps): React.JSX.Element | null {
  // Mounted only while open, so every opening starts from a clean form.
  return props.visible ? <ItemForm {...props} /> : null
}

function ItemForm({ onClose, table, item }: ItemSheetProps): React.JSX.Element {
  const readOnly = useApp((s) => s.readOnly)
  const initialPrice = item?.price != null ? formatAmountInput(item.price, table.currency) : ''
  const [name, setName] = useState(item?.name ?? '')
  const [qty, setQty] = useState(item ? qtyText(item.qty) : '1')
  const [price, setPrice] = useState(initialPrice)
  const [link, setLink] = useState(item?.link ?? '')
  const [qtyError, setQtyError] = useState<string | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)

  const dirty = item
    ? name.trim() !== item.name ||
      qty !== qtyText(item.qty) ||
      price !== initialPrice ||
      link.trim() !== (item.link ?? '')
    : !!name.trim() || qty !== '1' || !!price.trim() || !!link.trim()
  const close = (): void => closeOrConfirm(dirty, onClose)

  const save = (): void => {
    const clean = name.trim()
    if (!clean) return
    // The quantity stays a number (it is not money) and must be above zero.
    const parsedQty = parseDecimalInput(qty)
    if (!parsedQty || parsedQty.lte(0)) return setQtyError(INVALID_QTY_TEXT)
    // An empty price is allowed (no price); anything else must be a positive amount.
    const value = price.trim() === '' ? undefined : parseAmount(price, table.currency)
    if (value === null) return setPriceError(INVALID_AMOUNT_TEXT)
    const quantity = parsedQty.toNumber()
    const cleanLink = link.trim() || undefined

    let outcome: FinanceOutcome
    if (item) {
      // Only what changed goes to the core, so an unchanged legacy price is never rounded.
      const updates: ItemUpdates = {}
      if (clean !== item.name) updates.name = clean
      if (quantity !== item.qty) updates.qty = quantity
      if (price !== initialPrice) updates.price = value && D(value).toDecimalPlaces(2).toString()
      if (cleanLink !== item.link) updates.link = cleanLink
      if (Object.keys(updates).length === 0) return onClose()
      outcome = applyFinance(
        (tables, now) => updateItem(tables, table.id, item.id, updates, now),
        setPriceError
      )
    } else {
      outcome = applyFinance(
        (tables, now) =>
          addItem(
            tables,
            table.id,
            { name: clean, qty: quantity, price: value, link: cleanLink },
            now
          ),
        setPriceError
      )
    }
    if (outcome.ok) onClose()
  }

  return (
    <BottomSheet visible onClose={close} title={item ? 'Editar item' : 'Novo item'}>
      <Field label="Nome do item" value={name} onChangeText={setName} autoFocus={!item} />
      <Field
        label="Quantidade"
        value={qty}
        onChangeText={(text) => {
          setQty(text)
          setQtyError(null)
        }}
        keyboardType="decimal-pad"
        error={qtyError}
      />
      <Field
        label={`Preço por unidade (${table.currency}, opcional)`}
        value={price}
        onChangeText={(text) => {
          setPrice(text)
          setPriceError(null)
        }}
        keyboardType="decimal-pad"
        error={priceError}
      />
      <Field
        label="Link (opcional)"
        value={link}
        onChangeText={setLink}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        variant="primary"
        label={item ? 'Salvar' : 'Adicionar item'}
        onPress={save}
        disabled={readOnly || !name.trim()}
      />
      <Button variant="ghost" label="Cancelar" onPress={close} />
    </BottomSheet>
  )
}
