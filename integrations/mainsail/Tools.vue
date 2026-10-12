<template>
    <iframe ref="tools" title="Klipper Tools" src="/tools/app/" class="klipper-tools" :style="frameStyle" scrolling="no" @load="sendAppearance" />
</template>

<script lang="ts">
import Vue from 'vue'

export default Vue.extend({
    data: () => ({ locked: false, contentHeight: null as number | null, removeGuard: null as null | (() => void) }),
    computed: {
        frameStyle(): Record<string, string> {
            return this.contentHeight === null ? {} : { height: `${this.contentHeight}px`, minHeight: '0' }
        },
        appearanceKey(): string {
            return `${this.$vuetify.theme.dark}:${this.$i18n.locale}:${this.$store.state.gui.uiSettings.primary}`
        },
    },
    watch: {
        contentHeight() {
            this.$nextTick(this.sendViewport)
        },
        '$route'() {
            this.$nextTick(this.sendViewport)
        },
        appearanceKey() {
            this.$nextTick(this.sendAppearance)
        },
    },
    mounted() {
        window.addEventListener('message', this.receiveState)
        window.addEventListener('scroll', this.sendViewport, true)
        window.addEventListener('resize', this.sendViewport)
        this.removeGuard = this.$router.beforeEach((_to, from, next) => {
            if (from.name === 'tools' && this.locked) next(false)
            else next()
        })
    },
    beforeDestroy() {
        window.removeEventListener('message', this.receiveState)
        window.removeEventListener('scroll', this.sendViewport, true)
        window.removeEventListener('resize', this.sendViewport)
        this.removeGuard?.()
    },
    methods: {
        sendViewport() {
            const frame = this.$refs.tools as HTMLIFrameElement
            if (!frame.getClientRects().length) return
            const rect = frame.getBoundingClientRect()
            const topbarBottom = document.querySelector('.v-app-bar')?.getBoundingClientRect().bottom ?? 64
            const top = Math.max(0, topbarBottom - rect.top)
            const bottom = Math.min(rect.height, window.innerHeight - rect.top)
            frame.contentWindow?.postMessage(
                { type: 'kcw-viewport', top, height: Math.max(0, bottom - top) },
                window.location.origin
            )
        },
        sendAppearance() {
            const frame = this.$refs.tools as HTMLIFrameElement
            const style = getComputedStyle(frame)
            frame.contentWindow?.postMessage(
                {
                    type: 'kcw-appearance',
                    theme: this.$vuetify.theme.dark ? 'dark' : 'light',
                    language: this.$i18n.locale,
                    colors: {
                        primary: style.getPropertyValue('--color-primary').trim(),
                        primaryText: style.getPropertyValue('--v-btn-text-primary').trim(),
                        warning: style.getPropertyValue('--color-warning').trim(),
                    },
                },
                window.location.origin
            )
            this.sendViewport()
        },
        receiveState(event: MessageEvent) {
            const frame = this.$refs.tools as HTMLIFrameElement
            if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return
            if (event.data?.type === 'kcw-navigation-state' && typeof event.data.locked === 'boolean') {
                this.locked = event.data.locked
                const height = event.data.height
                if (height === null) this.contentHeight = null
                else if (typeof height === 'number' && Number.isFinite(height) && height > 0 && height <= 100000) {
                    this.contentHeight = Math.ceil(height)
                }
            }
        },
    },
})
</script>

<style scoped>
.klipper-tools {
    display: block;
    width: 100%;
    max-width: 1152px;
    margin: 0 auto;
    height: 128px;
    min-height: 0;
    border: 0;
}
</style>
