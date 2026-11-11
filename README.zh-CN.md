# iSCSI 管理器：简体中文版

这是 [brainchillz/unraid-iscsi-manager](https://github.com/brainchillz/unraid-iscsi-manager) 的简体中文分支，用于让 Unraid 直接提供 iSCSI 虚拟磁盘，无需通过 fnOS 虚拟机转发。

界面、说明、确认对话框、输入校验与安装提示已简体中文化。协议名、IQN、API 字段、设备路径保持原样。底层内核或 rtslib 返回的详细诊断可能仍为英文，前面会显示中文错误说明。

## 安装

支持 Unraid 6.12+ / 7.x，当前发行包为 x86_64 架构。在 Unraid 的「插件 → 安装插件」中填写：

```
https://raw.githubusercontent.com/Lxy521031/unraid-iscsi-manager/feat/simplified-chinese/iscsi.manager.plg
```

安装后打开「设置 → iSCSI 管理器」。插件及升级检查均指向此中文分支，发行包通过 MD5 校验。安装不会自动创建或格式化磁盘。

## 直接提供虚拟磁盘

1. 在阵列或存储池中准备专用目录。先确认实际空间、共享设置和 mover 策略；正在使用的镜像不应由 mover 搬动。
2. 点「新建后端存储」，选择「镜像文件（fileio）」，设置英文名称、完整 `.img` 路径及容量，例如 `20G`。默认使用直写缓存。
3. 点「新建目标」，保留「受限」模式。创建目标后，在监听地址中选择要使用的存储网络 IP 和端口 `3260`。
4. 将镜像挂接为 LUN，再添加 Mac 客户端的 IQN 至客户端 ACL。
5. 在 Mac 的 iSCSI 客户端连接 Unraid 地址。仅对新建的测试盘进行格式化；如已有数据的磁盘提示未格式化，请先停止写入并检查映射。

镜像为稀疏文件，显示的虚拟容量不代表预留了实际空间。必须持续保证后端有足够可用空间。普通 APFS、NTFS 等文件系统不能由多台客户端同时以读写方式挂载。

## 兼容性调整

上游运行包包含 Python 3.9。本分支不安装 `/usr/bin/python3` 通用链接，控制脚本和 targetcli 明确使用 `/usr/bin/python3.9`，保留 Unraid 7.x 自带的 Python 3.12。其余 LIO 控制行为保持上游实现。

配置保存在 `/boot/config/iscsi/saveconfig.json`；阵列启动时恢复，停止前卸载内核中的活动目标。卸载插件保留已保存配置。已有连接应先在客户端安全推出和断开。

## 构建

Linux 下运行 `./build.sh 2026.11.11.1`。macOS 需要 GNU tar、GNU sed、GNU coreutils、xz 和 Python 3，并将 GNU 工具的 `libexec/gnubin` 放在 PATH 最前。打包产物位于 `packages/`；发布版本、`.plg` 和发行资产必须一致。
