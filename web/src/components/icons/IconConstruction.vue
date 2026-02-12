<template>
  <svg 
    :width="size" 
    :height="size" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path 
      d="M12 2L13.09 8.26L22 9L13.09 9.74L12 16L10.91 9.74L2 9L10.91 8.26L12 2Z" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round" 
      stroke-linejoin="round"
    />
    <path 
      d="M5 3V7" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round"
    />
    <path 
      d="M19 17V21" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round"
    />
    <path 
      d="M9 21H15" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round"
    />
    <path 
      d="M14 3L16 5L14 7" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round" 
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup>
defineProps({
  size: {
    type: [Number, String],
    default: 24
  }
})
</script>