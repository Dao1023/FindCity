# 科学图谱 —— 研究之所栖

将自然指数研究机构映射到城市，并以暗色天文台交互地图的形式可视化国家/城市层级的研究产出。

## 处理流程

```
data.csv（17,000 余家机构）
   ↓ ROR 匹配（SQLite FTS5 三元组 + 缩写 + Sorensen-Dice 相似度）
out/institutions.csv
   ↓ 聚合汇总
out/city_ranking.csv       （3,899 个城市）
out/country_ranking.csv    （176 个国家）
   ↓ Vite + Leaflet
viz/  → 带气泡图/热力图的暗色地图
```

## 快速开始

```bash
bun install
bun run all          # 构建 ROR 索引、匹配、聚合（首次运行约需 3 分钟）
bun run dev          # http://localhost:5173
bun run build        # → dist/
```

`bun run all` 首次运行时会从 Zenodo 下载 ROR v2 数据集（约 50MB），并缓存在 `.ror-cache/` 目录中。

## 可视化功能

- **粒度**：城市（3,899 个）↔ 国家（176 个）
- **指标**：贡献份额（Share）↔ 论文计数（Count）
- **视图**：气泡图 ↔ 热力图
- 国家质心为已匹配机构贡献份额的加权平均值。
- 悬停显示工具提示（顶尖机构/顶尖城市），点击侧边栏条目可飞行缩放至目标位置。

## 技术栈

- bun + TypeScript
- papaparse、fflate、bun:sqlite（FTS5 三元组索引）
- Vite、Leaflet、leaflet.heat
- CartoDB Dark Matter 底图 + Fraunces / JetBrains Mono 字体

## 数据来源

- **自然指数 2024** —— 机构级贡献份额/论文计数
- **ROR v2**（研究组织注册库）—— 各机构的城市/经纬度信息

## 覆盖率

匹配行贡献份额覆盖率达 98.1%（74,295 / 75,728）。