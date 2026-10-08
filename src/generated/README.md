# 这里是验收产物，不是插件源码

`order-list/index.tsx` 不是本插件的代码，而是 **AC9（落地到项目）的验收物证**：

独立验收者在真实界面里点「落地到项目」→ 拿到可复制的落地指令 → 交给一个独立 agent →
由它把当前设计屏按项目技术栈转成 React 组件写出来。它证明的是"**设计 → 代码**"这条链路真的通。

**保留它的理由**：验收报告 `docs/verification-feature-dsh-design-canvas.md` 的 AC9 结论直接指向这个文件，
删掉会让那条结论失去可复核的物证。

**本插件的真正源码**在 `client.js`（客户端半）、`index.js` 与 `src/host/`（host 半）。
