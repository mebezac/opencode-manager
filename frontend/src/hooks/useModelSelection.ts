import { useEffect, useCallback } from 'react'
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
  directory?: string,
  sessionID?: string
): UseModelSelectionResult {
  const { data: config } = useConfig(opcodeUrl, directory)
  const store = useModelStore()

  // Sync from config only on initial load (no session model yet)
  useEffect(() => {
    // Only sync from config if we don't have a model and no session model
    if (!store.model && sessionID && !store.getSessionModel(sessionID)) {
      store.syncFromConfig(config?.model)
    }
  }, [config?.model, store, sessionID])

  // Load session-specific model when session changes
  useEffect(() => {
    if (sessionID) {
      const sessionModel = store.getSessionModel(sessionID)
      if (sessionModel) {
        // Update the global model to match this session's model
        store.setModel(sessionModel, sessionID)
      }
    }
  }, [sessionID, store])

  useEffect(() => {
    store.loadFavoritesFromAPI()
  }, [store])

  const setModel = useCallback((model: ModelSelection) => {
    store.setModel(model, sessionID)
  }, [store, sessionID])

  return {
    model: store.model,
    modelString: store.getModelString(),
    recentModels: store.recentModels,
    favoriteModels: store.favoriteModels,
    setModel,
    toggleFavorite: store.toggleFavorite,
    isFavorite: store.isFavorite,
  }
}
