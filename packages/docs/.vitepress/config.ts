import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Quikcommit",
  description: "AI-powered conventional commit messages",
  base: "/",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Features", link: "/features/commit-messages" },
      { text: "API", link: "/api/overview" },
      { text: "CLI", link: "/cli/reference" },
      { text: "Pricing", link: "/pricing" },
    ],
    sidebar: {
      "/guide/": [
        { text: "Getting Started", link: "/guide/getting-started" },
        { text: "Installation", link: "/guide/installation" },
        { text: "Authentication", link: "/guide/authentication" },
        { text: "Configuration", link: "/guide/configuration" },
        { text: "Git Hooks", link: "/guide/git-hooks" },
      ],
      "/features/": [
        { text: "Commit Messages", link: "/features/commit-messages" },
        { text: "PR Descriptions", link: "/features/pr-descriptions" },
        { text: "Changelogs", link: "/features/changelogs" },
        { text: "Monorepo", link: "/features/monorepo" },
        { text: "Team Standards", link: "/features/team-standards" },
      ],
      "/api/": [
        { text: "Overview", link: "/api/overview" },
        { text: "Commit", link: "/api/commit" },
        { text: "PR", link: "/api/pr" },
        { text: "Changelog", link: "/api/changelog" },
        { text: "Usage", link: "/api/usage" },
      ],
      "/cli/": [{ text: "CLI Reference", link: "/cli/reference" }],
    },
  },
});
