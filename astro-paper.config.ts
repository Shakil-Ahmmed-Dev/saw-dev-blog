import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://saw-dev-blog-test.vercel.app/",
    title: "Shakil Ahmmed",
    description: "CSE Undergraduate, Full Stack Web Developer",
    author: "Shakil Ahmmed",
    profile: "https://github.com/Shakil-Ahmmed-Dev",
    ogImage: "default-og.jpg",
    lang: "en",
    timezone: "Asia/Dhaka",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
    perIndex: 4,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: true,
      url: "https://github.com/Shakil-Ahmmed-Dev/saw-dev-blog-test/edit/main/",
    },
    search: "pagefind",
    toc: true,
  },
  socials: [
    { name: "github",   url: "https://github.com/Shakil-Ahmmed-Dev" },
    { name: "x",        url: "https://x.com/saw_dev_bd" },
    { name: "linkedin", url: "https://www.linkedin.com/in/shakilahmmed-dev/" },
    { name: "mail",     url: "mailto:shakilahmmedwakil.dev@gmail.com" },
  ],
  shareLinks: [
    { name: "whatsapp", url: "https://wa.me/?text=" },
    { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
    { name: "x",        url: "https://x.com/intent/post?url=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "pinterest", url: "https://pinterest.com/pin/create/button/?url=" },
    { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  ],
});