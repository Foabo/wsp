# wsp

用软链接把多个仓库拼成一个目录，一条命令交给 agent。

```sh
wsp setup ~/.ws                                   # 一次性：默认根目录
wsp new payments ~/src/github/foo/api ~/src/github/foo/web
cd ~/.ws/payments
wsp copy          # 路径已经在你剪贴板里
```

工作区只是一个普通目录，里面除了软链接，还可以放你自己建的文件和文件夹。

## 安装

```sh
cd ~/src/github/foabo/wsp
bun install
bun link          # 生成 ~/.bun/bin/wsp，指向本仓库，改代码立刻生效
wsp --version
```

`bun unlink` 取消安装。要单文件分发：`bun run build`，产物是 `dist/wsp`。

## 命令

```sh
wsp new <dir> [repo...]        # 建工作区，可顺手把仓库链进来
wsp setup <dir>                # 设默认根目录，不存在会创建
wsp config [--json]            # 查看全局配置
wsp add <dir> [--as name]      # 加一个目录或文件
                [--relative]   # 存相对链接，整个工作区可以打包搬走
wsp ls [--json]                # 成员和链接状态
wsp ls --all [--json]          # 默认根目录下的所有工作区
wsp path [name] [--link]       # 打印工作区路径 / 仓库真实路径 / 链接路径
wsp copy [name] [--link]       # 把上面的路径复制到剪贴板
wsp pick [name]                # 交互选一个工作区，回车复制路径
wsp rm <name>                  # 摘掉成员，不碰目标
wsp doctor [--json]            # 检查断链、未登记链接、坑
wsp code                       # 重新生成 <name>.code-workspace
wsp agents                     # 重新生成 AGENTS.md 里的托管块
```

查找工作区的顺序：`--ws <dir>` → `$WSP_WORKSPACE` → 从当前目录向上找 `.wsp.json`。

## 默认根目录

`wsp setup ~/.ws` 之后，`wsp new demo` 建在 `~/.ws/demo`。

规则只有一条：**裸名字走根目录，带路径的按你写的走。**

| 输入 | 落在哪里 |
| --- | --- |
| `wsp new demo` | `<root>/demo` |
| `wsp new ./demo` | 当前目录下的 `demo` |
| `wsp new ../demo` | 上一级目录下的 `demo` |
| `wsp new /tmp/demo` | `/tmp/demo` |

想临时放别处，写 `./demo` 就行，不用改配置。

配置文件的位置按顺序取：`$WSP_CONFIG`、`$XDG_CONFIG_HOME/wsp/config.json`、`~/.config/wsp/config.json`。内容只有版本号和根目录，可以直接手改。

## 列出所有工作区

```sh
wsp ls --all
```

```
root  /Users/admin/.ws  (3 workspaces)
  scratch        0 members   2026-10-21 10:34  /Users/admin/.ws/scratch
  incident-1234  1 member    2026-10-21 10:34  /Users/admin/.ws/incident-1234
  payments       2 members   2026-10-21 10:34  /Users/admin/.ws/payments
```

按清单文件的修改时间倒序，最近动过的在最上面。扫描根目录往下三层，遇到工作区就停，不跟进软链接，也不会钻进成员的仓库里；清单坏掉时只标记 `(broken manifest)`，不影响其他条目。`--json` 给脚本和以后的 UI 用。

## 交互选择

`wsp ls --all` 的输出是一次性的，适合脚本和 agent。要在终端里挑一个：

```sh
wsp pick
```

```
? pick a workspace  up/down move . enter copy . esc cancel

> scratch        0 members   2026-10-20 08:00
  incident-1234  0 members   2026-10-15 12:00
  payments       0 members   2026-10-01 09:00

root  /Users/admin/.ws
```

↑/↓ 或 `j`/`k` 移动，回车把路径复制到剪贴板并打印出来，`Esc`、`q`、`Ctrl-C` 取消并返回 130。

键盘交互需要真终端。stdin 或 stdout 不是 TTY 时直接报错退出，不会卡在那里等输入；脚本和 agent 用 `wsp pick <name>` 或 `wsp ls --all`。

实现上没有引入依赖：原生模式读按键，逐帧重绘；选中后把列表擦掉，路径留在光标原来的位置，粘贴完就能接着干活。

每个工作区里有三样生成物：

- `.wsp.json`：成员清单，记录名字、真实路径、链接字符串
- `AGENTS.md`：托管块，成员表自动更新，块外内容不动
- `<name>.code-workspace`：给 VS Code / Cursor 直接打开的多根工作区

## 三个问题的实测答案

### 占多少空间

软链接只存一个路径字符串。实测两个仓库合计 232K，工作区 12K；`cp -R` 复制一份工作区，还是 12K。

会让体积失控的是跟随链接的操作：`cp -L`、`rsync -L`、`tar -h`，它们会把仓库内容复制进来。另外把工作区提交进 git 再 clone 到别的机器，只有链接字符串过去了，目标不在就是断链。

在同一卷上复制真实文件，macOS 用 APFS clonefile：实测复制一个 200MB 文件，磁盘只多出约 5.5MB 元数据。跨卷或网络盘没有这个待遇。

### git 正常吗

在成员目录里，全部正常：

- `git status` 正常；
- `git rev-parse --show-toplevel` 返回仓库的真实路径；
- `git worktree add ../wt/x -b feat` 之后用软链接把 worktree 挂进工作区，`git -C ws/x status` 也正常。

在工作区根目录，它不是一个仓库，`git status` 会报 `not a git repository`。

最需要小心的一种情况：如果你在工作区根目录执行 `git init`，那些软链接会以 `120000` 的链接对象被提交，仓库里的任何改动对这个 git 都不可见。`wsp doctor` 会为此报警。

规则就一句：**git 在成员里跑，wsp 在工作区里跑。**

### 搜索为什么找不到东西

ripgrep 默认不跟随软链接。实测在工作区根目录 `rg` 找不到成员里的文件，加 `--follow` 才找到；`fd` 要 `-L`，`find` 要 `-L`。

这条规则写进了生成的 `AGENTS.md`，agent 会读到。你自己的 shell 里记得加参数。

## 设计取舍

**用软链接，不用真目录或子模块。** 零复制、不改变仓库原来的位置、删工作区不伤仓库、成员随时可换。代价是上面那三条边界。

**保留 `.wsp.json`。** 只有清单才能区分"wsp 管理的链接"和"你手动建的链接"，`rm` 和 `doctor` 才不会误删或误报；以后做 GUI 也直接读它。

**自动写 `AGENTS.md` 和 `.code-workspace`。** 软链接的三个坑（搜索、git、路径）必须写在 agent 读得到的上下文里，否则每次都要重新解释。VS Code 那种多根视图则直接用生成的 workspace 文件。

**默认绝对链接。** 移动工作区时仍指向原仓库。加 `--relative` 则是相对链接，适合把工作区和仓库一起打包搬走。

## 已知边界

- 不是 monorepo：跨仓依赖、统一构建、统一 lockfile 都不管。
- macOS 上 `process.cwd()` 返回物理路径：站在 `space/api` 里执行时，Node 和 Bun 拿到的都是 `repos/api`。`wsp` 靠 shell 的 `$PWD` 找回工作区，成员里任意深度的目录都行；脚本环境不设 `PWD` 时请用 `--ws`。
- 备份和同步工具对软链接的处理不一致，iCloud、Time Machine 可能跳过或单独存储。
- 工作区根的 `git init` 是坑，`doctor` 只警告，不阻止。

## 路线图

- `wsp rg` / `wsp fd`：自动带 `--follow` 的搜索包装
- 不依赖 `$PWD` 的定位方式：脚本里从成员目录执行时也能找到所属工作区
- 在 picker 里直接看成员，或者按 `/` 过滤
- Finder Quick Action：右键文件夹加入工作区
- 本地 Web UI：读 `wsp ls --json`，做浏览和增删

## 开发

```sh
bun test
bun run typecheck
bun run build
```
