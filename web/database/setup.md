# Supabase 数据库设置指南

## 1. 在 Supabase Dashboard 中执行 SQL

访问你的 Supabase 项目：https://supabase.com/dashboard/project/myenzpblosjnrtvicdor

### 步骤 1: 创建 admin_profiles 表

在 SQL Editor 中执行 `database/migrations/001_create_admin_profiles.sql` 中的内容。

### 步骤 2: 创建 rulesets 表

在 SQL Editor 中执行 `database/migrations/002_create_rulesets.sql` 中的内容。

## 2. 创建管理员用户

### 方法 1: 通过 Supabase Dashboard

1. 进入 Authentication > Users
2. 点击 "Add user"
3. 输入管理员邮箱和密码
4. 创建用户后，复制用户的 UUID

### 方法 2: 通过 SQL

```sql
-- 首先在 Authentication 中创建用户，然后获取 UUID
-- 假设你的管理员邮箱是 admin@example.com，UUID 是 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

INSERT INTO public.admin_profiles (id, email) 
VALUES ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'admin@example.com');
```

## 3. 测试管理员登录

创建管理员用户后，你就可以使用该邮箱和密码登录管理后台了。

## 4. 添加更多管理员

如果需要添加更多管理员，重复步骤 2 即可。

## 5. 验证设置

你可以在 SQL Editor 中运行以下查询来验证设置：

```sql
-- 查看所有管理员
SELECT * FROM public.admin_profiles;

-- 查看所有规则集
SELECT * FROM public.rulesets;

-- 测试权限（需要先登录）
SELECT auth.uid(), auth.email();
```