import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import Home from '../views/Home.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Home,
      meta: {
        title: '首页'
      }
    },
    {
      path: '/rulesets',
      name: 'rulesets',
      component: () => import('../views/RulesetList.vue'),
      meta: {
        title: '规则集'
      }
    },
    {
      path: '/rulesets/:id',
      name: 'ruleset-detail',
      component: () => import('../views/RulesetDetail.vue'),
      meta: {
        title: '规则集详情'
      }
    },
    {
      path: '/answer-viewer',
      name: 'answer-viewer',
      component: () => import('../views/AnswerViewer.vue'),
      meta: {
        title: '答案查看器'
      }
    },
    {
      path: '/tutorial',
      name: 'tutorial',
      component: () => import('../views/Tutorial.vue'),
      meta: {
        title: '使用教程'
      }
    },
    {
      path: '/upload',
      name: 'upload',
      component: () => import('../views/Upload.vue'),
      meta: {
        title: '上传规则集'
      }
    },
    {
      path: '/admin',
      name: 'admin-login',
      component: () => import('../views/AdminLogin.vue'),
      meta: {
        title: '管理员登录'
      }
    },
    {
      path: '/admin/dashboard',
      name: 'admin-dashboard',
      component: () => import('../views/AdminDashboard.vue'),
      meta: {
        requiresAuth: true,
        requiresAdmin: true,
        title: '管理后台'
      }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFound.vue'),
      meta: {
        title: '页面未找到'
      }
    }
  ],
  scrollBehavior(to, from, savedPosition) {
    // Always scroll to top when navigating to a new route
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  }
})

// Navigation guard for protected routes
router.beforeEach(async (to, from, next) => {
  // Set page title
  if (to.meta.title) {
    document.title = `${to.meta.title} - Auto366`
  }

  // Check if route requires authentication
  if (to.meta.requiresAuth) {
    const authStore = useAuthStore()

    // Wait for auth initialization if still loading
    if (authStore.loading) {
      // Wait a bit for auth to initialize
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Check authentication status
    if (!authStore.isAuthenticated) {
      // Redirect to admin login with return path
      next({
        name: 'admin-login',
        query: { redirect: to.fullPath }
      })
      return
    }

    // Check if route requires admin privileges
    if (to.meta.requiresAdmin && !authStore.isAdmin) {
      // Redirect to home if not admin
      next({ name: 'home' })
      return
    }
  }

  // If going to admin login and already authenticated, redirect to dashboard
  if (to.name === 'admin-login' && useAuthStore().isAuthenticated) {
    next({ name: 'admin-dashboard' })
    return
  }

  // Allow navigation
  next()
})

// Navigation guard after each route change
router.afterEach((to, from) => {
  // Close mobile menu if it's open
  // This will be handled by the UI store in components

  // Log navigation for debugging (remove in production)
  if (import.meta.env.DEV) {
    console.log(`Navigated from ${from.name} to ${to.name}`)
  }
})

export default router
