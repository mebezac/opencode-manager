import { useEffect, useCallback, useMemo } from 'react'
import { useConfig, useMessages } from './useOpenCode'
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

function normalizeModel(providerID: string, modelID: string): ModelSelection {
  if (providerID === 'synthetic' && modelID.includes('/')) {
    const [normalizedProviderID, ...modelParts] = modelID.split('/')
    const normalizedModelID = modelParts.join('/')
    if (normalizedProviderID && normalizedModelID) {
      return {
        providerID: normalizedProviderID,
        modelID: normalizedModelID,
      }
    }
  }

  return { providerID, modelID }
}

export function useModelSelection(
  opcodeUrl: string | null | undefined,
  directory?: string,
  sessionID?: string
): UseModelSelectionResult {
  const { data: config } = useConfig(opcodeUrl, directory)
  const { data: messages } = useMessages(opcodeUrl, sessionID, directory)
  const model = useModelStore((state) => state.model)
  const recentModels = useModelStore((state) => state.recentModels)
  const favoriteModels = useModelStore((state) => state.favoriteModels)
  const setStoreModel = useModelStore((state) => state.setModel)
  const getSessionModel = useModelStore((state) => state.getSessionModel)
  const syncFromConfig = useModelStore((state) => state.syncFromConfig)
  const getModelString = useModelStore((state) => state.getModelString)
  const loadFavoritesFromAPI = useModelStore((state) => state.loadFavoritesFromAPI)
  const toggleFavorite = useModelStore((state) => state.toggleFavorite)
  const isFavorite = useModelStore((state) => state.isFavorite)

  const inferredSessionModel = useMemo((): ModelSelection | null => {
    if (!messages || messages.length === 0) return null

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]?.info
      if (!message) continue

      if ('model' in message && message.model?.providerID && message.model?.modelID) {
        return normalizeModel(message.model.providerID, message.model.modelID)
      }

      if ('providerID' in message && 'modelID' in message && message.providerID && message.modelID) {
        return normalizeModel(message.providerID, message.modelID)
      }
    }

    return null
  }, [messages])

  // Sync from config only on initial load (no session model yet)
  useEffect(() => {
    // Only sync from config if we don't have a model and no session model
    if (!model && sessionID && !getSessionModel(sessionID)) {
      syncFromConfig(config?.model)
    }
  }, [config?.model, model, sessionID, getSessionModel, syncFromConfig])

  // Load session-specific model when session changes
  useEffect(() => {
    if (!sessionID) return

    const sessionModel = getSessionModel(sessionID)
    if (!sessionModel) return

    const isAlreadyActiveModel =
      model?.providerID === sessionModel.providerID && model?.modelID === sessionModel.modelID

    if (!isAlreadyActiveModel) {
      setStoreModel(sessionModel, sessionID)
    }
  }, [sessionID, getSessionModel, model, setStoreModel])

  // Seed session model from message history when missing
  useEffect(() => {
    if (!sessionID || !inferredSessionModel) return
    if (getSessionModel(sessionID)) return
    setStoreModel(inferredSessionModel, sessionID)
  }, [sessionID, inferredSessionModel, getSessionModel, setStoreModel])

  useEffect(() => {
    loadFavoritesFromAPI()
  }, [loadFavoritesFromAPI])

  const setModel = useCallback((model: ModelSelection) => {
    setStoreModel(model, sessionID)
  }, [setStoreModel, sessionID])

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
