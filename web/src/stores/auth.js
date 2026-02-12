import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { supabase, auth } from '../lib/supabase.js'

export const useAuthStore = defineStore('auth', () => {
  // State
  const user = ref(null)
  const session = ref(null)
  const loading = ref(false)

  // Getters
  const isAuthenticated = computed(() => {
    return !!session.value && !!user.value
  })

  const isAdmin = computed(() => {
    // Check if user is authenticated and exists in admin_profiles table
    return isAuthenticated.value && user.value?.id
  })

  const userDisplayName = computed(() => {
    return user.value?.email || 'Unknown User'
  })

  // Actions
  const setUser = (userData) => {
    user.value = userData
  }

  const setSession = (sessionData) => {
    session.value = sessionData
    if (sessionData?.user) {
      setUser(sessionData.user)
    } else {
      setUser(null)
    }
  }

  const setLoading = (loadingState) => {
    loading.value = loadingState
  }

  const login = async (credentials) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password
      })

      if (error) {
        console.error('Login error:', error)
        return { 
          success: false, 
          error: getErrorMessage(error)
        }
      }

      if (data.session && data.user) {
        setSession(data.session)
        
        // Check if user is admin by querying admin_profiles table
        const { data: adminProfile, error: profileError } = await supabase
          .from('admin_profiles')
          .select('*')
          .eq('id', data.user.id)
          .single()

        console.log('Admin profile check:', { adminProfile, profileError, userId: data.user.id })

        if (profileError) {
          console.error('Error checking admin profile:', profileError)
          if (profileError.code === 'PGRST116') {
            // User not found in admin_profiles table
            await supabase.auth.signOut()
            setSession(null)
            return {
              success: false,
              error: '您没有管理员权限。请联系系统管理员添加您的账户。'
            }
          } else if (profileError.code === 'PGRST205') {
            // Table doesn't exist
            await supabase.auth.signOut()
            setSession(null)
            return {
              success: false,
              error: '系统配置错误：admin_profiles 表不存在。请联系技术支持。'
            }
          } else {
            // Other database errors
            await supabase.auth.signOut()
            setSession(null)
            return {
              success: false,
              error: `数据库错误：${profileError.message}`
            }
          }
        }

        if (!adminProfile) {
          // User is not an admin, sign them out
          await supabase.auth.signOut()
          setSession(null)
          return {
            success: false,
            error: '您没有管理员权限。请联系系统管理员添加您的账户。'
          }
        }

        // Update last login time
        await supabase
          .from('admin_profiles')
          .update({ last_login: new Date().toISOString() })
          .eq('id', data.user.id)

        return { 
          success: true, 
          user: data.user,
          session: data.session
        }
      }

      return { 
        success: false, 
        error: '登录失败，请重试'
      }
    } catch (error) {
      console.error('Login error:', error)
      return { 
        success: false, 
        error: '登录过程中发生错误，请稍后重试'
      }
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    setLoading(true)
    try {
      const { error } = await supabase.auth.signOut()
      
      if (error) {
        console.error('Logout error:', error)
        return { 
          success: false, 
          error: '登出失败，请重试'
        }
      }

      setSession(null)
      return { success: true }
    } catch (error) {
      console.error('Logout error:', error)
      return { 
        success: false, 
        error: '登出过程中发生错误'
      }
    } finally {
      setLoading(false)
    }
  }

  const checkAuthStatus = async () => {
    setLoading(true)
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      
      if (error) {
        console.error('Auth status check error:', error)
        setSession(null)
        return { 
          success: false, 
          error: error.message,
          authenticated: false
        }
      }

      if (session) {
        setSession(session)
        
        // Verify admin status
        const { data: adminProfile } = await supabase
          .from('admin_profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (!adminProfile) {
          // User is not an admin, sign them out
          await supabase.auth.signOut()
          setSession(null)
          return {
            success: true,
            authenticated: false,
            error: '管理员权限已失效'
          }
        }

        return { 
          success: true, 
          authenticated: true,
          user: session.user
        }
      } else {
        setSession(null)
        return { 
          success: true, 
          authenticated: false
        }
      }
    } catch (error) {
      console.error('Auth status check error:', error)
      setSession(null)
      return { 
        success: false, 
        error: error.message,
        authenticated: false
      }
    } finally {
      setLoading(false)
    }
  }

  const initializeAuth = async () => {
    // Check current session on app initialization
    await checkAuthStatus()

    // Listen for auth state changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email)
      
      if (event === 'SIGNED_IN' && session) {
        setSession(session)
      } else if (event === 'SIGNED_OUT') {
        setSession(null)
      } else if (event === 'TOKEN_REFRESHED' && session) {
        setSession(session)
      }
    })
  }

  // Helper function to get user-friendly error messages
  const getErrorMessage = (error) => {
    switch (error.message) {
      case 'Invalid login credentials':
        return '邮箱或密码错误'
      case 'Email not confirmed':
        return '邮箱未验证，请检查您的邮箱'
      case 'Too many requests':
        return '请求过于频繁，请稍后重试'
      case 'User not found':
        return '用户不存在'
      default:
        return error.message || '登录失败，请重试'
    }
  }

  return {
    // State
    user,
    session,
    loading,
    
    // Getters
    isAuthenticated,
    isAdmin,
    userDisplayName,
    
    // Actions
    setUser,
    setSession,
    setLoading,
    login,
    logout,
    checkAuthStatus,
    initializeAuth
  }
})