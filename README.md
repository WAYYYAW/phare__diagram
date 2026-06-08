# xuben — 相图绘制与分析工具

> 基于 Go + WebAssembly + Plotly.js 的交互式相图（Phase Diagram）分析与可视化工具。

## 技术栈

| 层 | 技术 |
|---|---|
| **计算引擎** | Go 1.21 — 编译为 WASM，通过 `syscall/js` 桥接 |
| **前端可视化** | Plotly.js 2D/3D 图表 + Canvas 2D 渲染 |
| **前端框架** | 原生 JavaScript (无框架依赖) |
| **部署选项** | 开发模式：Go 静态文件服务器；生产模式：单文件 HTML（内嵌 WASM base64） |

## 核心功能 — 3 个模块

### 1️⃣ 二元相图 (Binary / 2D)

- **预置多套经典二元相图模板**：
  - 简单共晶相图
  - 包晶相图 (Pt-Ag 体系)
  - 溶混间隙相图 (Cu-Pb 体系)
  - 铁碳相图 (Fe-Fe₃C)
  - 匀晶(固溶体)相图
- 每个模板的参数可调（熔点、温度、成分等）
- **杠杆定律计算**：点击相图区域自动计算两相/三相分数
- **相区自动着色**：基于多边形填充算法识别相区
- 支持手动编辑特征点和边界线，支持贝塞尔曲线插值

### 2️⃣ 三元相图 (Ternary / 3D)

- 3D 三角形坐标系：A-B-C 三组分 + 温度轴
- **Coons 曲面**：使用 3 边 / 4 边 Coons 补丁构建曲面
- **等温面**：显示任意温度的等温截面
- **2D 投影**：3D 曲面按等温面切割投影至 2D 三角图
- 数据持久化：保存 / 加载 JSON 格式

### 3️⃣ 浓度三角形 (Triangle)

- Canvas 2D 交互式渲染
- **4 种分析模式**：
  - 成分点显示 — 点击显示 A/B/C 百分含量及方向箭头
  - 顶点连线 — 显示与三个顶点的连线及比例关系
  - 两相平衡 — 在杠杆上根据距离计算两相比例
  - 三相平衡 — 在三角形内根据线段法计算三相比例

## 项目结构

```
xuben/
├── server.go                   # 静态文件服务器 (:8080)
├── Makefile                    # 编译构建
├── go.mod                      # Go 模块定义
├── cmd/bundle/main.go          # 单文件 HTML 打包工具
├── wasm/                       # Go WASM 计算引擎
│   ├── main.go                 # WASM 入口 + JS 函数注册
│   ├── types.go                # 数据结构定义
│   ├── templates.go            # 5 套相图模板定义
│   ├── binary.go               # 二元相图核心算法
│   ├── ternary.go              # 三元相图核心算法
│   └── triangle.go             # 浓度三角形几何算法
└── web/                        # 前端资源
    ├── index.html              # 主页面
    ├── bundle.html             # 单文件版本 (构建生成)
    ├── css/style.css           # 样式
    └── js/
        ├── app.js              # 应用状态管理
        ├── binary.js           # 二元相图前端
        ├── ternary.js          # 三元相图前端
        ├── triangle.js         # 浓度三角形前端
        └── wasm_exec.js        # Go WASM 运行时
```

## 快速开始

### 开发模式

```bash
make run
# 启动后访问 http://localhost:8080
```

分步执行：

```bash
make wasm     # Go → WASM 编译
make server   # 编译静态文件服务器
./xuben-server
```

### 生成单文件 HTML（无需服务器）

```bash
make bundle
# 生成 web/bundle.html，直接在浏览器打开即可运行
```

### 文件体积

| 组件 | 说明 |
|---|---|
| `main.wasm` | ~1MB (Go 编译的 WASM 二进制) |
| `bundle.html` | ~8MB (内嵌 WASM base64 + Plotly + CSS + JS) |

## 架构

```
┌─────────────┐     Plotly.js      ┌──────────────┐
│  index.html  │ ←─── 可视化 ────→  │  JS Frontend  │
│  (或 bundle) │                    │  (app.js +    │
└─────────────┘                    │   binary.js   │
                                   │   ternary.js  │
                                   │   triangle.js)│
                                   └──────┬───────┘
                                          │ syscall/js
                                   ┌──────▼───────┐
                                   │  Go WASM     │
                                   │ ────────────  │
                                   │ binary.go    │
                                   │ ternary.go   │
                                   │ triangle.go  │
                                   │ templates.go │
                                   │ types.go     │
                                   └──────────────┘
```

- 前端负责 UI 渲染和用户交互
- WASM 负责所有数值计算（杠杆定律、贝塞尔插值、Coons 曲面等）
- 数据以 JSON 字符串形式在 JS ↔ WASM 之间传递

## 应用场景

- **材料科学教学**：直观展示合金相图，支持杠杆定律交互计算
- **科研辅助**：三元相图 3D 可视化，等温面切割分析
- **相图设计**：参数化模板，快速查看成分/温度变化对相图的影响
