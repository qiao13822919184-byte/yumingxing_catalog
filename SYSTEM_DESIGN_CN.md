# 在线图册系统：页面与后台设计

## 目标与业务流程

业务员发送网站地址 → 客户查看分类与产品图片 → 搜索/材质筛选 → 查看具体款式和组件 → 点击 + 加入了解清单 → 填写数量与备注 → 下载 CSV/PDF 或用 WhatsApp 联系销售 → 业务员据唯一 SKU 制作报价。

本系统不展示价格、不处理付款、不把打开 WhatsApp 记为已提交询盘。当前不收集客户姓名或联系方式到数据库。

## 前台的设计思路

深绿导航与页尾强调金属餐厨具的稳重质感，铜橙色标记重要操作。标题用衬线字，产品资料用清晰的无衬线字。首屏包括系列主题、真实厨具图与分类入口；产品目录紧随其后。

产品图片在统一展台容器中完整等比显示。桌面默认三列、可在后台调整，手机两列；长名称自然换行。产品卡片将唯一识别码、产品名、型号、材质与加入清单分层展示，避免重复显示全部参数。

详情用多图展台、双语名称、原货号/型号/唯一识别码、组件表、动态属性和详情模块组成。小屏幕改为上下排版，宽组件表仅在表格内部横向滚动。

了解清单是独立弹窗。客户先选款，再补充意向数量与问题；这些选品状态明确保存在当前浏览器，不假装跨设备同步。

## 后台的四个工作区域

| 区域 | 可控制的内容 | 数据影响 |
|---|---|---|
| 产品 | 新增/编辑/删除、分类、顺序、主图/图库、双语描述、上下架、组件、自定义参数和详情块 | 线上编辑保存到当前会话，点击发布后写入仓库，构建通过后更新客户图册；未核验产品不能上架 |
| 分类 | 名称、双语描述、封面图、顺序、新增/删除 | 前台分类入口与筛选共用同一数据，发布后同步线上 |
| 页面设计 | 品牌文字、标题、强调色、列表列数、WhatsApp 号码 | 预览确认后随本次内容一同发布 |
| 版本与访问 | 线上 GitHub 提交记录与令牌；本机 JSON 导入导出、完整本地备份及密码 | 两种管理方式各自维护数据和访问权限 |

编辑过程展示产品预览。未保存切换时提示，失败时保留输入。已有 SKU 固定作为识别键；展示名称和原货号仍然可修改。

## 4 件套变成 9 件套的具体操作

1. 后台搜索产品并打开编辑器，需要另一种独立款式时先新增产品。
2. 上传新的实拍主图，原图仍可保留为图库中的参考图。
3. 在组件区增加相应名称行，填写每一类组件的实际数量和规格，调整展示顺序。
4. 更新中英文名称/说明。新增包装方式、表面工艺等参数时直接加自定义属性行。
5. 新增图文说明块，展示包装、细节或组合说明。
6. 检查预览，完成核验并保存。前台组件表和导出清单按实际数组生成，无需更改模板代码。
7. 在线上管理页点击“发布到网站”，待 GitHub Pages 部署通过后，线上客户即可看到更新。本机后台的保存只影响本机数据。

组件种类与总件数不同。例如 1 把刀、1 把叉、7 把勺是 3 种组件、9 件。不能把表格行数直接当作套装件数；数量未记录时不推算总件数。

## 数据结构与扩展边界

线上 `content/catalog.json` 保存完整产品数组和页面设置，是 GitHub Pages 构建的内容来源。本机 SQLite `products` 表保留可索引字段：`id`、`sku`、`category`、`published`、`sort_order`、`updated_at`；完整产品结构保存在 `document` JSON。两处采用相同产品概念，但不会自动双向同步。

```text
Product
  id / sku（稳定且唯一）
  catalogId（原货号） / model（型号）
  nameEn / nameZh / descriptionEn / descriptionZh
  image / gallery[]
  category（稳定分类ID） / order / published / verificationStatus
  components[]  → 名称、材质、尺寸、重量、厚度、数量、单位
  attributes[]  → 任意参数名称和值
  blocks[]      → 可排序的文本块或图片块

Settings
  brand / headlineEn / headlineZh / accent / columns / whatsapp
  categories[] → 稳定ID、双语名称与描述、封面图、顺序
```

独立 `meta` 表保存设置和初始化标记；`admins`、`sessions` 保存账号及会话；`audit_log` 记录修改行为。上传图片作为文件保存在 `data/media/`。清空所有产品后初始化标记仍保留，不会重新导入已经删除的初始资料。

当前线上管理由 GitHub 仓库写权限控制，可视化页面只编辑内容；本机服务仍采用独立管理员账号和 SQLite。如果以后需要多人独立业务角色、私密草稿、销售个人号码、客户在线提交询盘、版本审批、图片裁剪、拖拽式整页设计、颜色/规格库存或 ERP 对接，可扩展相应对象和服务器接口。这些没有被冒充为当前功能。

## 线上管理的实现与边界

线上管理入口为 [产品图册/admin/](https://qiao13822919184-byte.github.io/yumingxing_catalog/admin/)。GitHub Pages 托管静态编辑页面；浏览器直接通过 GitHub REST API 读写固定仓库。GitHub REST 支持跨来源请求，因此这个方案不需要另设代理服务器。[GitHub CORS 说明](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)

管理者提供仅授权本仓库、具有 Contents 读写权限的 fine-grained PAT，令牌仅在当前页面内存中使用。刷新、退出或关闭页面后重新连接；令牌不进入产品导出、localStorage、sessionStorage、URL、代码或日志。本地账号密码不能登录线上编辑器。GitHub 负责仓库写入认证；公开静态页面本身不作为权限防线。

编辑保存只更新内存中的工作稿。发布时校验完整产品和设置、上传新增图片对象、创建基于当前版本的 Git tree/commit，再以非强制方式更新 `main`。只允许写入 `content/catalog.json` 与 `content/media/` 文件；不允许后台编辑代码、工作流或任意路径。更新前后通过版本比较及非强制分支更新防止覆盖其他提交。GitHub 的 Contents 权限本身是仓库级权限，界面的路径限制并不能把令牌限制成目录级权限。[Git tree 接口](https://docs.github.com/en/rest/git/trees)、[Git references 接口](https://docs.github.com/en/rest/git/refs)

上传图片与产品引用在同一次提交生效，避免客户读取到半套资料。提交成功不等于已上线：Actions 仍要校验、构建并部署。构建失败时保留先前成功部署的客户页面。公开 Actions 状态可不带令牌读取，管理员无需为查看进度额外开放 Actions 或仓库管理权限。[工作流状态接口](https://docs.github.com/en/rest/actions/workflow-runs)

仓库公开可读，`content/catalog.json` 包含草稿。草稿与图片只是不进入客户列表，不具保密性；内部报价、客户隐私、账号密码不适合存入这些字段。删除当前内容也不会自动删除 Git 历史中的旧版本。

## 导出和 WhatsApp 的边界

- CSV：一行一个唯一 SKU，包含原货号、型号、双语名称、意向数量、备注与完整组件数据。UTF-8 BOM 可改善 Excel 中文打开体验，危险公式前缀按文本处理。
- PDF：实际文件，逐页绘制，包含产品图和双语参数；长内容自动分页。为避免客户设备缺中文字库，页面以图片嵌入 PDF，代价是无法直接搜索或复制 PDF 文字。
- WhatsApp 文本入口：使用国家区号号码和预填文本，客户检查后自行发送。过长清单明确提示用附件，不无声丢弃产品行。
- 手机文件分享：先生成 PDF，再由用户点击系统分享按钮；能否看到 WhatsApp 由设备和浏览器决定。不能预选收件人或保证送达。
- 销售报价：CSV 最适合继续加工为报价表。原货号相同的不同样式通过唯一 SKU 区分。

实现依据：[WhatsApp 官方 Click to Chat](https://faq.whatsapp.com/5913398998672934)、[Web Share 标准](https://www.w3.org/TR/web-share/)、[MDN navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)。

## 部署与维护责任

本机正式服务为 http://127.0.0.1:3000，管理入口为 http://127.0.0.1:3000/admin，数据库与原始上传图片仍在本机。GitHub 保存源码、初始静态素材、线上编辑内容 `content/catalog.json` 和线上上传图片 `content/media/`；本机运行数据库、原始上传目录、初始密码与日志由 `.gitignore` 排除。

客户网址为 [https://qiao13822919184-byte.github.io/yumingxing_catalog/](https://qiao13822919184-byte.github.io/yumingxing_catalog/)。GitHub Pages 提供静态前台与管理编辑页面，客户页面使用构建生成的公开快照浏览产品、生成文件和跳转 WhatsApp，清单只保存在各自浏览器。线上管理不连接本机数据库，本机关闭不影响客户浏览和线上管理。

发布流程为：线上编辑并预览 → 点击发布 → 原子提交内容与图片到 GitHub → Actions 校验 `content/` → 仅从已核验且上架产品生成客户快照 → 构建 `dist-pages/` → 部署。快照不包含本机管理员、会话、审计或草稿。`publication/` 是构建产物，不是线上内容的权威来源，CI 会按仓库内容重新生成。

“发布前台.cmd”已改为提示线上管理地址，不再导出本机数据库覆盖仓库。`export:public` 可保留用于本机离线快照；本地与线上间迁移数据应先备份、对照最新内容后处理。GitHub 提交历史用于恢复已发布内容，通过新的恢复提交或 `git revert` 完成，不使用强制推送。

如果以后需要私密产品草稿、客户数据库或保存立即生效，可自行准备公网服务器及 HTTPS，运行现有 Node.js 服务并保留可写数据目录。首次在另一台机器启动会生成独立随机管理员密码，不会上传或共享本机密码。日常操作和令牌说明见 [GITHUB_ADMIN_CN.md](GITHUB_ADMIN_CN.md)。
