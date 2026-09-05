# GitHub 线上管理使用说明

客户浏览：[YUMINGXING 在线图册](https://qiao13822919184-byte.github.io/yumingxing_catalog/)

管理入口：[线上管理系统](https://qiao13822919184-byte.github.io/yumingxing_catalog/admin/)

电脑和手机都可以打开管理页。产品、分类、组件和页面内容发布后存入您自己的 GitHub 仓库，不需要本机保持开机，也不需要 Codex Sites 或另一台服务器。

## 第一次连接

使用拥有本仓库写权限的 GitHub 账号登录 GitHub，打开 [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens)，选择 **Generate new token**。

1. 名称可填 `Yumingxing catalogue admin`，设置您方便定期更新的有效期，例如 30 天。
2. **Resource owner** 选择 `qiao13822919184-byte`。
3. **Repository access** 选择 **Only select repositories**，只勾选 `yumingxing_catalog`。
4. **Repository permissions** 中添加 **Contents → Read and write**。Metadata 读取权限由 GitHub 配套提供。不要额外勾选 Administration、Workflows 或其他仓库。
5. 生成并复制令牌，返回上方线上管理地址，将其粘贴到连接输入框，然后连接仓库。

GitHub 官方说明支持限定资源所有者、仓库和权限；这个项目用到的 Git blob/tree/commit 写入接口支持 fine-grained PAT 的 Contents 写权限。[令牌设置说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[创建 Git blob](https://docs.github.com/en/rest/git/blobs)、[创建 Git commit](https://docs.github.com/en/rest/git/commits)

**令牌相当于本仓库的编辑钥匙，不是网站公开内容。** 不要发给聊天助手、截图分享、写入代码或产品字段。管理页只在当前页面内存中使用它，不替您永久保存；可用自己的密码管理器保管。退出、刷新或关闭页面后，下一次需要重新输入。本地 `admin` 密码仅用于 `127.0.0.1` 后台，不能用于此处。

Contents 读写权限覆盖整个所选仓库，GitHub 不能把此权限进一步缩小到产品目录。管理页面自身只提交产品数据和图片；请只在上述正确的 HTTPS 管理地址输入令牌。

## 修改与发布

1. 连接后从 GitHub 最新版本载入全部产品与设置，选择要修改的产品或新增产品。
2. 修改名称、分类、主图/图库，或在组件区增加、删除、排序行。增加到 9 件套时按实际组件和数量填写，无需固定成 9 行。
3. 检查产品预览，点击“暂存产品”；分类和页面设计也可调整并暂存。
4. 点击 **发布到网站**。产品资料和本次新图片会一起写入一条 GitHub 提交，避免只上传一半。
5. 等待页面发布状态或 [Pages 发布记录](https://github.com/qiao13822919184-byte/yumingxing_catalog/actions/workflows/pages.yml)显示成功，再打开客户网址检查。

暂存到编辑会话并不代表已写入 GitHub。尚未发布的输入和图片只在当前页面中，刷新或关闭前应完成发布，或点击“下载编辑草稿”保留 JSON 并另存新图片原文件。JSON 不包含实际图片。提交成功后还需要等待构建部署；构建失败时客户页面保持上一次成功上线的内容。

仓库是公开的：草稿、上传图片和历史版本可在仓库读取。草稿状态只控制客户图册是否展示，不是保密设置。不要保存内部报价、客户资料或密码。

## 连接或发布失败

| 提示或现象 | 处理方式 |
|---|---|
| 无法连接、令牌无效或到期 | 在 GitHub 检查令牌是否有效，必要时生成相同最小权限的新令牌再连接 |
| 没有写权限 / 403 | 检查令牌所选资源所有者、唯一仓库和 Contents 读写权限；组织审批或分支规则也可能拒绝写入，不要通过增加无关权限绕过 |
| 发现远端已有更新 / 版本冲突 | 先保留本页改动资料，重新载入最新版本再合并编辑；系统不会强制覆盖其他提交 |
| 网络中断，无法确定是否已提交 | 先查看仓库最近提交和 Pages 记录；确认后再操作，避免盲目重复发布 |
| 已提交，但网页还没更新 | 查看对应提交的 Pages 工作流。运行中继续等待；失败时查看失败步骤，修正后重新发布 |
| 发布状态暂时无法读取 | 可直接打开 Pages 发布记录。公开状态读取不需要扩大令牌权限 |

如果令牌遗失、到期或不再使用，回到 [GitHub 令牌管理](https://github.com/settings/personal-access-tokens)删除或更换相应令牌。撤销不会删除网站和已发布产品；只是该令牌不能再写入仓库。若曾把令牌公开，请撤销后再生成，不要继续使用旧令牌。

## 撤销一次产品修改

小范围修正可以直接在管理页改回原值，重新发布。较大误改可打开 [内容提交历史](https://github.com/qiao13822919184-byte/yumingxing_catalog/commits/main/content/catalog.json)，找到出错的提交，由维护者对该提交执行 `git revert`，检查内容并正常推送。恢复会生成新提交，旧历史仍保留；不要使用 `git reset --hard` 加强制推送来“回到过去”。多个后续提交有相关修改时，先核对冲突和需要保留的内容。恢复后的提交也需要通过 Pages 构建。

只恢复 JSON 不会自动恢复已经删除的图片；需要一并恢复引用的图片文件。当前从产品中移除图片不会清除 Git 历史。Git 历史不是私密资料存储，也不是本机 SQLite 的备份。

## 和本机后台的关系

今后维护线上图册，请使用此线上管理入口。`content/catalog.json` 是线上内容来源；本机 `data/catalog.sqlite` 是独立数据，不会自动同步。

双击原来的“发布前台.cmd”现在会提示线上管理入口，请打开其中的网址继续。本机 `admin` 登录、保存产品或更新代码不会改变线上数据，也不会从线上更新本机数据库。若需要迁移旧电脑中的另一套资料，应先对照线上最新数据并做备份，再明确迁移范围，避免把旧资料覆盖到线上。
