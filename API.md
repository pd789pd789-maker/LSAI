# 小红书图片生成应用后端 API 文档

本文档涵盖了用户认证和待办事项的 API 接口，并包含了积分机制的说明。

## 数据库连接配置说明
应用启动前，需要在一个 `.env` 文件或环境变量服务商（如 Zeabur，Vercel，AI Studio 的环境变量配置界面）配置好以下环境变量：
- `MONGODB_URI`: 你的 MongoDB 数据库 URI 连接字符串。（例如：`mongodb+srv://admin:password@cluster0.xxx.mongodb.net/todo-app?retryWrites=true&w=majority`）
- `JWT_SECRET` (可选): 用于颁发 Token 的密钥。如果不配置则会自动调用内置生成的后备变量。

## API Base URL
生产环境：`/api`

---

## 1. 用户模块

### 1.1 用户注册
- **URL**: `/api/auth/register`
- **Method**: `POST`
- **Body 参数**:
  - `email` (string, required): 邮箱地址
  - `password` (string, required): 密码
- **响应 (201 Created)**:
  ```json
  {
    "token": "eYJ...",
    "user": {
      "email": "user@example.com",
      "points": 100
    }
  }
  ```

### 1.2 用户登录
- **URL**: `/api/auth/login`
- **Method**: `POST`
- **Body 参数**:
  - `email` (string, required): 邮箱地址
  - `password` (string, required): 密码
- **响应 (200 OK)**:
  ```json
  {
    "token": "eYJ...",
    "user": {
      "email": "user@example.com",
      "points": 100
    }
  }
  ```

### 1.3 获取当前用户 (以及积分)
- **URL**: `/api/auth/me`
- **Method**: `GET`
- **Headers**:
  - `Authorization: Bearer <你的 Token>`
- **响应 (200 OK)**:
  ```json
  {
    "email": "user@example.com",
    "points": 100
  }
  ```

---

## 2. 待办事项模块

### 2.1 获取待办事项列表
- **URL**: `/api/todos`
- **Method**: `GET`
- **Headers**:
  - `Authorization: Bearer <你的 Token>`
- **响应 (200 OK)**:
  ```json
  [
    {
      "_id": "673f...",
      "title": "购买颜料",
      "description": "关于小红书教程需要的东西",
      "completed": false,
      "deadline": "2026-05-25T12:00:00.000Z",
      "createdAt": "2026-05-22T04:10:00.000Z"
    }
  ]
  ```

### 2.2 创建待办事项
- **URL**: `/api/todos`
- **Method**: `POST`
- **Headers**:
  - `Authorization: Bearer <你的 Token>`
- **Body 参数**:
  - `title` (string, required): 标题
  - `description` (string, optional): 详情说明
  - `deadline` (string/date, optional): 截止日期
  - `completed` (boolean, optional): 默认 false
- **响应 (201 Created)**: (返回刚创建的 Todo 对象)

### 2.3 更新待办事项
- **URL**: `/api/todos/:id`
- **Method**: `PUT`
- **Headers**:
  - `Authorization: Bearer <你的 Token>`
- **Body 参数**: 
  可包含 `title`, `description`, `completed`, `deadline`，按需传入需要更新的数据。
- **响应 (200 OK)**

### 2.4 删除待办事项
- **URL**: `/api/todos/:id`
- **Method**: `DELETE`
- **Headers**:
  - `Authorization: Bearer <你的 Token>`
- **响应 (200 OK)**:
  ```json
  {
    "message": "待办事项已删除"
  }
  ```

---

## 3. 积分生图扣除说明
本代码修改了原有的图片生成接口(`/api/generate-images`)。
如果你在系统环境变量中配置了 `MONGODB_URI`，该接口就会自动启动积分校验模式。
- 调用生图接口时，请求 Header 需附带 `Authorization: Bearer <Token>`。
- **扣费规则**：
  - `1k` 画质: 扣除 6 积分
  - `2k` 画质: 扣除 8 积分
  - `4k` 画质: 扣除 10 积分
- 额度不足时 API 会抛出 `积分不足` 的错误。
