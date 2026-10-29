import { App, Modal, Setting } from 'obsidian';

import { tr } from './i18n';
/**
 * 删除、清空这类操作前的确认，用 Obsidian 自己的弹窗代替浏览器 confirm()（手机上没有原生对话框）。
 * 点“确定”得到 true；取消、按 Esc 或点遮罩关闭都是 false。
 */
export function confirmAction(app: App, message: string, confirmText = tr('确定', 'OK')): Promise<boolean> {
	return new Promise((resolve) => {
		let answered = false;
		const modal = new (class extends Modal {
			onOpen() {
				this.modalEl.addClass('ap', 'ap-modal');
				this.setTitle(tr('请确认', 'Please confirm'));
				for (const line of message.split('\n')) this.contentEl.createEl('p', { text: line });
				new Setting(this.contentEl)
					.addButton((button) => button.setButtonText(tr('取消', 'Cancel')).onClick(() => this.close()))
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
