/**
 * The presentation menu: which arrangement it names, what it offers from there,
 * and that choosing one calls the frame once.
 *
 * The component reads the frame through the standard `useWorkstation` and
 * `useIde` hooks, so the spec supplies them as plain selectors over fixed
 * values - the same shape the renderer's provideRoot contribution has.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { WorkstationToggle } from '../src/client/WorkstationToggle.tsx'
import type { WorkstationToggleProps } from '../src/client/WorkstationToggle.tsx'

/** One of the two arrangements the frame can show. */
type Presentation = 'workstation' | 'ide'

/** Mount the menu as if the frame showed `current`, and collect the gesture. */
function mount(current: Presentation): {
  present: ReturnType<typeof vi.fn>
  trigger: HTMLElement
  container: HTMLElement
} {
  const present = vi.fn()
  const seat = current === 'ide'
  const props = {
    t: makeTranslate(zh),
    present,
    useWorkstation: <S,>(select: (state: boolean) => S): S => select(seat),
    useIde: <S,>(select: (state: boolean) => S): S => select(seat),
  } as unknown as WorkstationToggleProps
  const { container } = render(<WorkstationToggle {...props} />)
  const trigger = container.querySelector<HTMLElement>('[data-workstation-toggle]')
  if (trigger === null) throw new Error('the presentation menu has no trigger')
  return { present, trigger, container }
}

/** The menu items currently offered. */
function itemsOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-presentation]')]
}

afterEach(cleanup)

describe('WorkstationToggle', () => {
  it('names the arrangement the frame is in', () => {
    expect(mount('workstation').trigger.textContent).toContain(zh['present.workstation'])
    expect(mount('ide').trigger.textContent).toContain(zh['present.ide'])
  })

  it('reports the arrangement it names', () => {
    expect(mount('workstation').trigger.getAttribute('data-stage')).toBe('workstation')
    expect(mount('ide').trigger.getAttribute('data-stage')).toBe('ide')
  })

  it('stays closed until asked', () => {
    const { container } = mount('workstation')
    expect(itemsOf(container)).toHaveLength(0)
    expect(container.querySelector('[data-presentation-menu]')).toBeNull()
  })

  it('offers the other arrangement from the workstation', () => {
    const { container, trigger } = mount('workstation')
    fireEvent.click(trigger)
    expect(itemsOf(container).map(item => item.getAttribute('data-presentation')))
      .toEqual(['ide'])
  })

  it('offers the other arrangement from the IDE', () => {
    const { container, trigger } = mount('ide')
    fireEvent.click(trigger)
    expect(itemsOf(container).map(item => item.getAttribute('data-presentation')))
      .toEqual(['workstation'])
  })

  it('goes straight to the chosen arrangement and closes', () => {
    const { container, trigger, present } = mount('ide')
    fireEvent.click(trigger)
    fireEvent.click(itemsOf(container)[0] as HTMLElement)
    expect(present).toHaveBeenCalledTimes(1)
    expect(present).toHaveBeenCalledWith('workstation')
    expect(itemsOf(container)).toHaveLength(0)
  })

  it('steps aside entirely on a server page, where the arrangements do not apply', () => {
    const props = {
      t: makeTranslate(zh),
      present: vi.fn(),
      useWorkstation: <S,>(select: (state: boolean) => S): S => select(true),
      useIde: <S,>(select: (state: boolean) => S): S => select(true),
      useServerMode: <S,>(select: (state: boolean) => S): S => select(true),
    } as unknown as WorkstationToggleProps
    const { container } = render(<WorkstationToggle {...props} />)
    expect(container.querySelector('[data-workstation-toggle]')).toBeNull()
  })
})
