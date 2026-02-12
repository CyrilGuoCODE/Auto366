<template>
  <svg 
    :width="size" 
    :height="size" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    :class="className"
  >
    <polygon 
      points="23 7 16 12 23 17 23 7" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round" 
      stroke-linejoin="round"
    />
    <rect 
      x="1" 
      y="5" 
      width="15" 
      height="14" 
      rx="2" 
      ry="2" 
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
    type: [String, Number],
    default: 24
  },
  className: {
    type: String,
    default: ''
  }
})
</script>