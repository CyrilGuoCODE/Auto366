import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './style.css'

// Initialize and validate configuration
import { validateConfig } from './config/index.js'

// Validate configuration before starting the app
validateConfig() // Now just warns instead of throwing

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// Initialize authentication after Pinia is set up
import { useAuthStore } from './stores/auth.js'

// Initialize auth store and check authentication status
const initializeApp = async () => {
  const authStore = useAuthStore()
  await authStore.initializeAuth()
  
  // Mount the app after auth initialization
  app.mount('#app')
}

// Start the application
initializeApp().catch(error => {
  console.error('Failed to initialize app:', error)
  // Mount the app anyway to show error state
  app.mount('#app')
})
