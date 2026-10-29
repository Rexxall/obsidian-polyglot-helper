import { App, Modal, Setting } from 'obsidian';

/**
 * 删除、清空这类操作前的确认，用 Obsidian 自己的弹窗代替浏览器 confirm()（手机上没有原生对话框）。
 * 点“确定”得到 true；取消、按 Esc 或点遮罩关闭都是 false。
 */
export function confirmAction(app: App, message: string, confirmText = '确定'): Promise<boolean> {
	return new Promise((resolve) => {
		let answered = false;
		const modal = new (class extends Modal {
			onOpen() {
				this.modalEl.addClass('ap', 'ap-modal');
				this.setTitle('请确认');
				for (const line of message.split('\n')) this.contentEl.createEl('p', { text: line });
				new Setting(this.contentEl)
					.addButton((button) => button.setButtonText('取消').onClick(() => this.close()))
					.addButton((button) =>
						button
							.setButtonText(confirmText)
							.setClass('mod-warning')
							.onClick(() => {
								answered = true;
								this.close();
							}),
					);
			}
			onClose() {
				this.contentEl.empty();
				resolve(answered);
			}
		})(app);
		modal.open();
	});
}
