import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { WidgetDefinition } from '../widgets/registry'

type Labelled = Pick<WidgetDefinition, 'type' | 'title' | 'description' | 'parts'>

/**
 * A widget's name, description and part labels in this device's language (#456,
 * locales/<lang>/widgets.json by widget type). The registry keeps the German as the source and as
 * the fallback - a widget a language doesn't know yet shows that.
 */
export function useWidgetText() {
  const { t } = useTranslation('widgets')
  return useMemo(() => {
    // Keys are built from the widget type, so they can't be typed one by one.
    const text = (key: string, fallback: string) => t(key as never, { defaultValue: fallback }) as string
    return {
      title: (definition: Pick<Labelled, 'type' | 'title'>) => text(`${definition.type}.title`, definition.title),
      description: (definition: Pick<Labelled, 'type' | 'description'>) => text(`${definition.type}.description`, definition.description),
      parts: (definition: Pick<Labelled, 'type' | 'parts'>) =>
        definition.parts?.map((part) => ({ ...part, label: text(`${definition.type}.parts.${part.id}`, part.label) })),
    }
  }, [t])
}
