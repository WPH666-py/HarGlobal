import { describe, expect, it } from 'vitest'
import { orderSettingsSections } from '../src/client/section-order.ts'

describe('orderSettingsSections', () => {
  it('places ClashVPN directly under Models even when another row shares that order', () => {
    expect(orderSettingsSections([
      { id: 'general', order: 0 },
      { id: 'clashvpn', order: 11 },
      { id: 'models', order: 10 },
      { id: 'routing', order: 10 },
    ]).map(row => row.id)).toEqual(['general', 'models', 'clashvpn', 'routing'])
  })

  it('leaves a list that already has that order, or that lacks either row', () => {
    const adjacent = [
      { id: 'models', order: 10 },
      { id: 'clashvpn', order: 11 },
    ]
    expect(orderSettingsSections(adjacent)).toEqual(adjacent)
    expect(orderSettingsSections([{ id: 'models', order: 10 }]).map(row => row.id)).toEqual(['models'])
    expect(orderSettingsSections([{ id: 'clashvpn', order: 11 }]).map(row => row.id)).toEqual(['clashvpn'])
    expect(orderSettingsSections([])).toEqual([])
  })
})
