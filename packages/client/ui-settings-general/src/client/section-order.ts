/** One settings nav row the shell is about to paint. */
export interface OrderedSection {
  readonly id: string
  readonly order: number
}

/**
 * Order settings sections, then place ClashVPN directly under Models.
 *
 * Numeric order alone leaves ClashVPN after every other row that shares Models'
 * order. The product asks for it as the next nav item.
 * @param rows - section rows as the slot ledger listed them.
 * @returns rows in nav order.
 */
export function orderSettingsSections<Row extends OrderedSection>(rows: readonly Row[]): Row[] {
  const sorted = rows.slice().sort((left, right) => left.order - right.order)
  const modelsAt = sorted.findIndex(row => row.id === 'models')
  const clashAt = sorted.findIndex(row => row.id === 'clashvpn')
  if (modelsAt < 0 || clashAt < 0 || clashAt === modelsAt + 1) return sorted
  const next = sorted.slice()
  const [moved] = next.splice(clashAt, 1)
  /* v8 ignore next -- splice of a known index returns that row */
  if (moved === undefined) return sorted
  next.splice(next.findIndex(row => row.id === 'models') + 1, 0, moved)
  return next
}
