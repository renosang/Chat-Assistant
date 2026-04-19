document.addEventListener('DOMContentLoaded', () => {
    console.log("[TestArea] Loaded Version: PronounFix-V2");
    // Chat UI Elements
    const chatBody = document.getElementById('chat-body');
    const textarea = document.getElementById('test-textarea');
    const sendBtn = document.getElementById('send-btn');
    const customerNameDisplay = document.getElementById('customer-name-display');

    // Section Toggling Elements
    const chatMain = document.getElementById('chat-main-section');
    const ticketMain = document.getElementById('ticket-main-section');
    const navChat = document.getElementById('nav-chat');
    const navTicket = document.getElementById('nav-ticket');

    // ---------- NAVIGATION ----------

    navChat.addEventListener('click', () => {
        chatMain.style.display = 'flex';
        ticketMain.style.display = 'none';
        navChat.classList.add('active');
        navChat.style.fontWeight = '700';
        navChat.style.color = 'inherit';
        navTicket.classList.remove('active');
        navTicket.style.fontWeight = '400';
        navTicket.style.color = 'var(--text-muted)';
    });

    navTicket.addEventListener('click', () => {
        chatMain.style.display = 'none';
        ticketMain.style.display = 'block';
        navTicket.classList.add('active');
        navTicket.style.fontWeight = '700';
        navTicket.style.color = 'inherit';
        navChat.classList.remove('active');
        navChat.style.fontWeight = '400';
        navChat.style.color = 'var(--text-muted)';
    });

    // ---------- TICKET SIMULATION ----------

    const simConcern = document.getElementById('sim-concern-issue');
    const simActiveConcernText = document.getElementById('sim-active-concern-value');
    const simRootCause = document.getElementById('sim-root-cause');
    const realRootCauseId = document.getElementById('real-root-cause-id');

    simConcern.addEventListener('change', () => {
        simActiveConcernText.textContent = simConcern.value;
        if (simConcern.value) {
            simActiveConcernText.style.display = 'block';
            // We need this in DOM for content.js detection
            simActiveConcernText.style.position = 'absolute';
            simActiveConcernText.style.opacity = '0';
            simActiveConcernText.style.pointerEvents = 'none';
            simActiveConcernText.style.height = '1px';
            simActiveConcernText.style.width = '1px';
            simActiveConcernText.style.overflow = 'hidden';
        } else {
            simActiveConcernText.style.display = 'none';
        }
    });

    simRootCause.addEventListener('change', () => {
        realRootCauseId.value = simRootCause.value;
    });

    // ---------- CHAT SIMULATION ----------

    function addMessage(text, type = 'received') {
        const div = document.createElement('div');
        div.className = 'msg ' + (type === 'received' ? 'received-customer' : 'sent');

        if (type === 'received') {
            div.className = 'msg received-customer chat-item chat-item--customer';
            div.innerHTML = `
                <div class="chat-avatar"><div class="avatar m-0"><img src="/images/portrait/default.png" alt="" height="25" width="25"></div></div>
                <div class="chat-item__body">
                    <div title="" class="chat-item__content">
                        <div><div>${text}</div></div>
                    </div>
                </div>
            `;
        } else {
            div.className = 'msg sent chat-item';
            div.innerHTML = `
                <div class="chat-item__body">
                    <div title="" class="chat-item__content">
                        <div><div>${text}</div></div>
                    </div>
                </div>
            `;
        }

        chatBody.appendChild(div);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function switchChannel(el, name) {
        document.querySelectorAll('.channel-items__el').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
        customerNameDisplay.textContent = name;

        chatBody.innerHTML = '';
        const brandName = name.split(' - ')[0];
        addMessage(`Chào bạn, shop còn hàng ${brandName} không?`, 'received');
        textarea.value = '';
    }

    function performUiSend() {
        const val = textarea.value.trim();
        if (!val) return;
        addMessage(val, 'sent');
        textarea.value = '';
    }

    // Event Listeners for Channels
    document.querySelectorAll('.channel-items__el').forEach(item => {
        item.addEventListener('click', function () {
            const name = this.querySelector('.channel-name').textContent;
            switchChannel(this, name);
        });
    });

    // Send Button - only adds to UI if NOT blocked by content.js
    sendBtn.addEventListener('click', () => {
        performUiSend();
    });

    // Enter Key
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            performUiSend();
        }
    });

    // Triggers (Buttons for simulating customer messages)
    // Ticket Save Logic - Should only run if NOT blocked by content.js
    const ticketSaveBtn = document.getElementById('ticket-save-btn');
    ticketSaveBtn.addEventListener('click', () => {
        // Show success notification
        const toast = document.createElement('div');
        toast.className = 'gemini-toast-success';
        toast.innerHTML = `
            <div style="background: #10b981; color: white; padding: 16px 32px; border-radius: 12px; position: fixed; bottom: 40px; right: 40px; font-weight: 700; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.3); z-index: 10000; animation: gemini-slide-up 0.3s ease;">
                ✅ Lưu Ticket thành công!
            </div>
        `;
        document.body.appendChild(toast);

        // Style for slide-up
        if (!document.getElementById('gemini-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'gemini-toast-styles';
            style.innerHTML = `
                @keyframes gemini-slide-up {
                    from { transform: translateY(100px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => {
            toast.style.transition = 'all 0.5s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(() => toast.remove(), 500);
        }, 3000);

        console.log("[TestArea] Ticket saved successfully!");
    });

    const triggers = {
        'logistics-btn': 'Sao đơn hàng của mình 1 tuần rồi vẫn nằm ở kho Long Bình vậy? Chờ lâu quá shop ơi!',
        'quality-btn': 'Hàng nhận về bị bể vỡ hết rồi shop ơi, làm ăn gì kì cục vậy vòi hỏng luôn rồi',
        'fake-btn': 'Mình thấy bao bì này khác with chai cũ mình mua, có phải hàng giả không shop?',
        'gifts-btn': 'Đơn hàng của mình không thấy có quà tặng kèm như quảng cáo shop ơi, thiếu quà rồi',
        'angry-btn': 'LÀM ĂN KIỂU GÌ VẬY HẢ?????????? QUÁ THẤT VỌNG LUÔN 🤬',
        'exclude-btn': 'Sản phẩm này giá bao nhiêu và cách dùng như thế nào vậy shop?',
        'clear-alert-btn': 'Dạ em cảm ơn shop nhiều ạ, phục vụ rất tốt',
        'test-pronoun-1': 'Chào anh/chị, anh vui lòng đợi em chút nhé.',
        'test-pronoun-2': 'Chào anh hoặc chị, shop em xin phép hỗ trợ ạ.',
        'test-pronoun-3': 'Chào anh và chị, chúc mình một ngày tốt lành.'
    };

    Object.keys(triggers).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                const message = triggers[id];
                if (id.startsWith('test-pronoun')) {
                    // For pronoun tests, we want to put it in the textarea to trigger content.js
                    textarea.value = message;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    textarea.focus();
                } else {
                    addMessage(message, 'received');
                }
            });
        }
    });

    // Initialize
    chatBody.innerHTML = '';
    addMessage('Chào bạn, shop còn hàng Brother không?', 'received');
});
