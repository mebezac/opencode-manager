import { useEffect } from 'react'
import { useConfig } from './useOpenCode'
import { useModelStore, type ModelSelection } from '@/stores/modelStore'

interface UseModelSelectionResult {
  model: ModelSelection | null
  modelString: string | null
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
  setModel: (model: ModelSelection) => void
  toggleFavorite: (model: ModelSelection) => void
  isFavorite: (model: ModelSelection) => boolean
}

export function useModelSelection(
  opcodeUrl: string | null | undefined,
  directory?: string
): UseModelSelectionResult {
  const { data: config } = useConfig(opcodeUrl, directory)
  const { model, recentModels, favoriteModels, setModel, syncFromConfig, getModelString, toggleFavorite, isFavorite, loadFavoritesFromAPI } = useModelStore()

  useEffect(() => {
    syncFromConfig(config?.model)
  }, [config?.model, syncFromConfig])

  useEffect(() => {
    loadFavoritesFromAPI()
  }, [loadFavoritesFromAPI])

  return {
    model,
    modelString: getModelString(),
    recentModels,
    favoriteModels,
    setModel,
    toggleFavorite,
    isFavorite,
  }
}
