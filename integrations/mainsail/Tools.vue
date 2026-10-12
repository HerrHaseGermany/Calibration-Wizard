<template>
    <iframe ref="tools" title="Klipper Tools" src="/tools/app/" class="klipper-tools" @load="sendAppearance" />
</template>

<script lang="ts">
import Vue from 'vue'

export default Vue.extend({
    data: () => ({ locked: false, removeGuard: null as null | (() => void) }),
    computed: {
        appearanceKey(): string {
            return `${this.$vuetify.theme.dark}:${this.$i18n.locale}`
        },
    },
    watch: {
        appearanceKey() {
            this.sendAppearance()
        },
    },
    mounted() {
        window.addEventListener('message', this.receiveState)
        this.removeGuard = this.$router.beforeEach((_to, from, next) => {
            if (from.name === 'tools' && this.locked) next(false)
            else next()
        })
    },
    beforeDestroy() {
        window.removeEventListener('message', this.receiveState)
        this.removeGuard?.()
    },
    methods: {
        sendAppearance() {
            const frame = this.$refs.tools as HTMLIFrameElement
            frame.contentWindow?.postMessage(
                {
                    type: 'kcw-appearance',
                    theme: this.$vuetify.theme.dark ? 'dark' : 'light',
                    language: this.$i18n.locale,
                },
                window.location.origin
            )
        },
        receiveState(event: MessageEvent) {
            const frame = this.$refs.tools as HTMLIFrameElement
            if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return
            if (event.data?.type === 'kcw-navigation-state' && typeof event.data.locked === 'boolean') {
                this.locked = event.data.locked
            }
        },
    },
})
</script>

<style scoped>
.klipper-tools {
    display: block;
    width: 100%;
    height: calc(100vh - 110px);
    min-height: 500px;
    border: 0;
}
</style>
