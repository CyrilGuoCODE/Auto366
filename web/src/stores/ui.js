import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useUIStore = defineStore('ui', () => {
  // State
  const isMobileMenuOpen = ref(false)
  const isLoading = ref(false)
  const notifications = ref([])
  const modals = ref({
    confirmDialog: {
      isOpen: false,
      title: '',
      message: '',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      onConfirm: null,
      onCancel: null
    }
  })

  // Getters
  const hasNotifications = computed(() => notifications.value.length > 0)
  
  const unreadNotifications = computed(() => 
    notifications.value.filter(n => !n.read)
  )

  // Actions
  const setMobileMenuOpen = (isOpen) => {
    isMobileMenuOpen.value = isOpen
  }

  const toggleMobileMenu = () => {
    isMobileMenuOpen.value = !isMobileMenuOpen.value
  }

  const setLoading = (loading) => {
    isLoading.value = loading
  }

  const addNotification = (notification) => {
    const id = Date.now().toString()
    const newNotification = {
      id,
      type: 'info', // 'success', 'error', 'warning', 'info'
      title: '',
      message: '',
      duration: 5000, // Auto-dismiss after 5 seconds
      read: false,
      createdAt: new Date().toISOString(),
      ...notification
    }
    
    notifications.value.unshift(newNotification)
    
    // Auto-dismiss if duration is set
    if (newNotification.duration > 0) {
      setTimeout(() => {
        removeNotification(id)
      }, newNotification.duration)
    }
    
    return id
  }

  const removeNotification = (id) => {
    const index = notifications.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notifications.value.splice(index, 1)
    }
  }

  const markNotificationAsRead = (id) => {
    const notification = notifications.value.find(n => n.id === id)
    if (notification) {
      notification.read = true
    }
  }

  const clearAllNotifications = () => {
    notifications.value = []
  }

  // Convenience methods for different notification types
  const showSuccess = (message, title = 'Success') => {
    return addNotification({
      type: 'success',
      title,
      message
    })
  }

  const showError = (message, title = 'Error') => {
    return addNotification({
      type: 'error',
      title,
      message,
      duration: 8000 // Errors stay longer
    })
  }

  const showWarning = (message, title = 'Warning') => {
    return addNotification({
      type: 'warning',
      title,
      message
    })
  }

  const showInfo = (message, title = 'Info') => {
    return addNotification({
      type: 'info',
      title,
      message
    })
  }

  // Modal management
  const openConfirmDialog = ({ title, message, confirmText, cancelText, onConfirm, onCancel }) => {
    modals.value.confirmDialog = {
      isOpen: true,
      title: title || 'Confirm Action',
      message: message || 'Are you sure?',
      confirmText: confirmText || 'Confirm',
      cancelText: cancelText || 'Cancel',
      onConfirm: onConfirm || (() => {}),
      onCancel: onCancel || (() => {})
    }
  }

  const closeConfirmDialog = () => {
    modals.value.confirmDialog.isOpen = false
  }

  const confirmAction = () => {
    const dialog = modals.value.confirmDialog
    if (dialog.onConfirm) {
      dialog.onConfirm()
    }
    closeConfirmDialog()
  }

  const cancelAction = () => {
    const dialog = modals.value.confirmDialog
    if (dialog.onCancel) {
      dialog.onCancel()
    }
    closeConfirmDialog()
  }

  return {
    // State
    isMobileMenuOpen,
    isLoading,
    notifications,
    modals,
    
    // Getters
    hasNotifications,
    unreadNotifications,
    
    // Actions
    setMobileMenuOpen,
    toggleMobileMenu,
    setLoading,
    addNotification,
    removeNotification,
    markNotificationAsRead,
    clearAllNotifications,
    
    // Convenience methods
    showSuccess,
    showError,
    showWarning,
    showInfo,
    
    // Modal actions
    openConfirmDialog,
    closeConfirmDialog,
    confirmAction,
    cancelAction
  }
})