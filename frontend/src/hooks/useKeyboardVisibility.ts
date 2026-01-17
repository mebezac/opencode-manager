import { useState, useEffect } from 'react'

export function useKeyboardVisibility() {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    // Only run on mobile devices
    if (typeof window === 'undefined' || !navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
      return
    }

    const handleResize = () => {
      // On iOS, when keyboard appears, the window.innerHeight decreases
      const currentHeight = window.innerHeight
      const landscapeHeight = window.innerWidth
      
      // Check if we're in portrait mode and keyboard might be visible
      if (currentHeight < landscapeHeight && currentHeight < 700) {
        // Keyboard is likely visible
        const newKeyboardHeight = landscapeHeight - currentHeight
        setIsKeyboardVisible(true)
        setKeyboardHeight(newKeyboardHeight)
      } else {
        // Keyboard is likely hidden
        setIsKeyboardVisible(false)
        setKeyboardHeight(0)
      }
    }

    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        // Small delay to allow iOS to resize the window
        setTimeout(handleResize, 100)
      }
    }

    const handleBlur = () => {
      // Small delay to allow iOS to resize the window back
      setTimeout(() => {
        setIsKeyboardVisible(false)
        setKeyboardHeight(0)
      }, 100)
    }

    // Initial check
    handleResize()

    // Add event listeners
    window.addEventListener('resize', handleResize)
    window.addEventListener('focusin', handleFocus)
    window.addEventListener('focusout', handleBlur)

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('focusin', handleFocus)
      window.removeEventListener('focusout', handleBlur)
    }
  }, [])

  return { isKeyboardVisible, keyboardHeight }
}