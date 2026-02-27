import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ModelSelection {
  providerID: string
  modelID: string
}

interface ModelStore {
  model: ModelSelection | null
  sessionModels: Record<string, ModelSelection>
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
  variants: Record<string, string | undefined>
  isInitialized: boolean
  favoritesLoaded: boolean
  lastConfigModel: string | undefined

  setModel: (model: ModelSelection, sessionID?: string) => void
  getSessionModel: (sessionID: string) => ModelSelection | null
  syncFromConfig: (configModel: string | undefined) => void
  getModelString: () => string | null
  setVariant: (model: ModelSelection, variant: string | undefined) => void
  getVariant: (model: ModelSelection) => string | undefined
  clearVariant: (model: ModelSelection) => void
  toggleFavorite: (model: ModelSelection) => void
  isFavorite: (model: ModelSelection) => boolean
  loadFavoritesFromAPI: () => Promise<void>
  setFavorites: (favorites: ModelSelection[]) => void
}

const MAX_RECENT_MODELS = 10

function parseModelString(model: string): ModelSelection | null {
  const [providerID, ...rest] = model.split('/')
  const modelID = rest.join('/')
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

export const useModelStore = create<ModelStore>()(
  persist(
    (set, get) => ({
      model: null,
      sessionModels: {},
      recentModels: [],
      favoriteModels: [],
      variants: {},
      isInitialized: false,
      favoritesLoaded: false,
      lastConfigModel: undefined,

      setModel: (model: ModelSelection, sessionID?: string) => {
        set((state) => {
          const newRecent = [
            model,
            ...state.recentModels.filter(
              (m) => !(m.providerID === model.providerID && m.modelID === model.modelID)
            ),
          ].slice(0, MAX_RECENT_MODELS)

          const updates: Partial<ModelStore> = {
            model,
            recentModels: newRecent,
          }

          // Also save per-session model if sessionID provided
          if (sessionID) {
            updates.sessionModels = {
              ...state.sessionModels,
              [sessionID]: model,
            }
          }

          return updates
        })
      },

      getSessionModel: (sessionID: string) => {
        const state = get()
        return state.sessionModels[sessionID] || null
      },

      syncFromConfig: (configModel: string | undefined) => {
        const state = get()
        if (state.lastConfigModel === configModel) return

        // Only sync from config if user hasn't explicitly selected a model
        if (state.model) return

        if (configModel) {
          const parsed = parseModelString(configModel)
          if (parsed) {
            const newRecent = [
              parsed,
              ...state.recentModels.filter(
                (m) => !(m.providerID === parsed.providerID && m.modelID === parsed.modelID)
              ),
            ].slice(0, MAX_RECENT_MODELS)

            set({ model: parsed, lastConfigModel: configModel, recentModels: newRecent })
            return
          }
        }
        set({ lastConfigModel: configModel })
      },

      getModelString: () => {
        const { model } = get()
        if (!model) return null
        return `${model.providerID}/${model.modelID}`
      },

      setVariant: (model: ModelSelection, variant: string | undefined) => {
        set((state) => {
          const key = `${model.providerID}/${model.modelID}`
          return {
            variants: {
              ...state.variants,
              [key]: variant,
            },
          }
        })
      },

      getVariant: (model: ModelSelection) => {
        const state = get()
        const key = `${model.providerID}/${model.modelID}`
        return state.variants[key]
      },

      clearVariant: (model: ModelSelection) => {
        set((state) => {
          const key = `${model.providerID}/${model.modelID}`
          const newVariants = { ...state.variants }
          delete newVariants[key]
          return {
            variants: newVariants,
          }
        })
      },

      toggleFavorite: async (model: ModelSelection) => {
        const state = get()
        const isFav = state.favoriteModels.some(
          (m) => m.providerID === model.providerID && m.modelID === model.modelID
        )

        try {
          if (isFav) {
            await fetch(`${API_BASE_URL}/api/favorites`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ providerID: model.providerID, modelID: model.modelID })
            })

            set({
              favoriteModels: state.favoriteModels.filter(
                (m) => !(m.providerID === model.providerID && m.modelID === model.modelID)
              ),
            })
          } else {
            await fetch(`${API_BASE_URL}/api/favorites`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ providerID: model.providerID, modelID: model.modelID })
            })

            set({
              favoriteModels: [...state.favoriteModels, model],
            })
          }
        } catch (error) {
          console.error('Failed to toggle favorite:', error)
        }
      },

      isFavorite: (model: ModelSelection) => {
        const state = get()
        return state.favoriteModels.some(
          (m) => m.providerID === model.providerID && m.modelID === model.modelID
        )
      },

      loadFavoritesFromAPI: async () => {
        const state = get()
        if (state.favoritesLoaded) return

        try {
          const response = await fetch(`${API_BASE_URL}/api/favorites`)
          if (response.ok) {
            const data = await response.json()
            set({
              favoriteModels: data.favorites || [],
              favoritesLoaded: true
            })
          }
        } catch (error) {
          console.error('Failed to load favorites from API:', error)
          set({ favoritesLoaded: true })
        }
      },

      setFavorites: (favorites: ModelSelection[]) => {
        set({ favoriteModels: favorites })
      },
    }),
    {
      name: 'opencode-model-selection',
      partialize: (state) => ({
        model: state.model,
        sessionModels: state.sessionModels,
        recentModels: state.recentModels,
        favoriteModels: state.favoriteModels,
        variants: state.variants,
      }),
    }
  )
)
