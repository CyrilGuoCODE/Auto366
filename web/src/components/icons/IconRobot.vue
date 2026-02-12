<template>
  <svg 
    :width="size" 
    :height="size" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    :class="className"
  >
    <rect 
      x="3" 
      y="11" 
      width="18" 
      height="10" 
      rx="2" 
      ry="2" 
      stroke="currentColor" 
      stroke-width="2"
    />
    <circle 
      cx="12" 
      cy="2" 
      r="1" 
      stroke="currentColor" 
      stroke-width="2"
    />
    <path 
      d="M12 3V7" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round"
    />
    <circle 
      cx="8.5" 
      cy="16" 
      r="1" 
      fill="currentColor"
    />
    <circle 
      cx="15.5" 
      cy="16" 
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