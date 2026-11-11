# iSCSI 管理器：简体中文版

这是 [brainchillz/unraid-iscsi-manager](https://github.com/brainchillz/unraid-iscsi-manager) 的简体中文分支，用于让 Unraid 直接提供 iSCSI 虚拟磁盘，无需通过 fnOS 虚拟机转发。

界面、说明、确认对话框、输入校验与安装提示已简体中文化。协议名、IQN、API 字段、设备路径保持原样。底层内核或 rtslib 返回的详细诊断可能仍为英文，前面会显示中文错误说明。

## 本分支修改

`fix/fua-persistence-session-count` 基于简体中文分支，增加 FUA 兼容模式、
修正命令行配置保存和动态客户端计数。缓存选项依次为直写、回写、
同步直写＋FUA 兼容；Mac 的每次写入策略推荐使用第三项。

内核动态会话文本可能以 `\0` 结尾，解析时去掉终止符和空项、去重，
保留完整中文 IQN，避免出现一个真实客户端加一条空白客户端。

## 安装

支持 Unraid 6.12+ / 7.x，当前发行包为 x86_64 架构。在 Unraid 的「插件 → 安装插件」中填写：

```
https://raw.githubusercontent.com/Lxy521031/unraid-iscsi-manager/fix/fua-persistence-session-count/iscsi.manager.plg
```

安装后打开「设置 → iSCSI 管理器」。插件及升级检查均指向此中文分支，发行包通过 MD5 校验。安装不会自动创建或格式化磁盘。

## 直接提供虚拟磁盘

1. 在阵列或存储池中准备专用目录。先确认实际空间、共享设置和 mover 策略；正在使用的镜像不应由 mover 搬动。
2. 点「新建后端存储」，选择「镜像文件（fileio）」，设置英文名称、完整 `.img` 路径及容量，例如 `20G`。默认使用直写缓存。父目录尚不存在时，可勾选“自动创建缺失的父目录”，支持 `/mnt` 下已挂载存储中的多级目录。创建失败时已建立的目录保留，不自动删除。
3. 点「新建目标」，保留「受限」模式。创建目标后，在监听地址中选择要使用的存储网络 IP 和端口 `3260`。
4. 将镜像挂接为 LUN，再添加 Mac 客户端的 IQN 至客户端 ACL。
5. 在 Mac 的 iSCSI 客户端连接 Unraid 地址。仅对新建的测试盘进行格式化；如已有数据的磁盘提示未格式化，请先停止写入并检查映射。

镜像为稀疏文件，显示的虚拟容量不代表预留了实际空间。必须持续保证后端有足够可用空间。普通 APFS、NTFS 等文件系统不能由多台客户端同时以读写方式挂载。

### Mac 的 FUA 写入兼容

如果 Mac iSCSI 客户端使用「On every write — safest」，而服务器日志提示
`does not advertise support for FUA write`，先断开客户端，再对相应镜像后端点
「启用 FUA 兼容」，然后重新连接。新建镜像时也可选「同步直写＋FUA 兼容」。

该模式保留 Linux fileio 的 `O_DSYNC` 同步写入，同时设置
`emulate_write_cache=1` 和 `emulate_fua_write=1`，让 LIO 接受 FUA。
这里的 WCE 是保守的能力声明，并不会重新打开文件或启用 `fd_buffered_io`。
界面从内核实际 I/O 模式区分同步直写和回写；插件保存配置时也会保持
`write_back=false`，避免重启恢复时被 rtslib 错当成缓冲回写。
已有回写后端不支持直接切换；块设备不应用此兼容选项。

从 2026.11.11.3 起，打包时修正内置 rtslib 的 fileio `write_back` 判断，
按内核 `Mode` 区分同步直写与回写。因此本插件、同一运行库下的
`targetcli saveconfig` 和 `targetctl save` 都会保留实际模式。无法识别模式时
拒绝导出，避免猜测。另行安装的未修补运行库不在此保证范围内。

## 兼容性调整

上游运行包包含 Python 3.9。本分支不安装 `/usr/bin/python3` 通用链接，控制脚本和 targetcli 明确使用 `/usr/bin/python3.9`，保留 Unraid 7.x 自带的 Python 3.12。FUA 兼容选项和配置保存处理见上文。

配置保存在 `/boot/config/iscsi/saveconfig.json`；阵列启动时恢复，停止前卸载内核中的活动目标。卸载插件保留已保存配置。已有连接应先在客户端安全推出和断开。

## 构建

Linux 下运行 `./build.sh 2026.11.11.4`。macOS 需要 GNU tar、GNU sed、GNU coreutils、xz 和 Python 3，并将 GNU 工具的 `libexec/gnubin` 放在 PATH 最前。打包产物位于 `packages/`；发布版本、`.plg` 和发行资产必须一致。

## 本次验证范围

- 8 项自动测试通过，覆盖 FUA 设置、失败回滚、活动连接保护、原子保存、NUL 结尾的中文 IQN，以及实际运行包中修补后的 fileio 判断。
- Unraid 7.3.4 / 内核 6.18.58-Unraid：修补前真实 `targetcli saveconfig` 将 O_DSYNC＋WCE=1 导出为 `write_back=true`；修补后正确导出为 `false`。
- 使用两个未导出的临时 8 MiB 后端验证命令行保存及 rtslib 恢复：同步后端恢复为 O_DSYNC、WCE=1、FUA=1；回写后端保持 Buffered-WCE。临时后端已清理，未覆盖在用配置。
- 页面确认缓存选项顺序和单个 Mac 客户端计数；现有 APFS 卷中两个测试文件 SHA-256 一致。
- FUA 兼容此前已验证 Mac 每次写入、安全推出和重新连接。未测试整机重启、真实断电或长期负载；未声称这些场景已通过。

## 版本留档说明

- `2026.11.11.2` 是本地构建并安装验证的中间版本，没有独立 Git 提交或 GitHub Release；其 FUA 功能代码已包含在 `436b617`（2026.11.11.3）中。不会将新版代码重新标成旧版来补造历史。
- `2026.11.11.3` 为已发布的 FUA 保存与客户端计数修复版。
- `2026.11.11.4` 新增可选的父目录自动创建，表单说明改为 ⓘ 悬停提示；构建脚本保留其他版本的安装包，避免后续构建清除本地旧包。13 项自动测试通过。
