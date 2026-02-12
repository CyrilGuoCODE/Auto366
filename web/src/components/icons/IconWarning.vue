<template>
  <svg 
    :width="size" 
    :height="size" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    :class="className"
  >
    <path 
      d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round" 
      stroke-linejoin="round"
    />
    <line 
      x1="12" 
      y1="9" 
      x2="12" 
      y2="13" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round"
    />
    <circle 
      cx="12" 
      cy="17" 
      r="1" 
      fill="currentColor"
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