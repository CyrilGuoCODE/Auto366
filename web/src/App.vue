<script setup>
import { RouterView } from 'vue-router'
import NavigationBar from './components/NavigationBar.vue'
import Footer from './components/Footer.vue'
</script>

<template>
  <div id="app">
    <NavigationBar />
    
    <main class="app-main">
      <RouterView />
    </main>
    
    <Footer />
  </div>
</template>

<style scoped>
#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-main {
  flex: 1;
  min-height: calc(100vh - 80px); /* Account for navigation height */
}
</style>
