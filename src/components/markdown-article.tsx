import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { convertObsidianLinks } from "@/lib/markdown/obsidian-links";
import { extractHeadings } from "@/lib/markdown/document-analysis";

export function MarkdownArticle({ content }: { content: string }) {
  const convertedContent = convertObsidianLinks(content);
  const renderedContent = convertedContent.replace(/^#\s+.+(?:\r?\n|$)/, "").trimStart();
  const headings = extractHeadings(renderedContent);
  let headingIndex = 0;
  return (
    <article className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 id={headings[headingIndex++]?.id}>{children}</h2>,
          h3: ({ children }) => <h3 id={headings[headingIndex++]?.id}>{children}</h3>,
          a: ({ href, children, ...props }) => {
            const destination = href ?? "#";
            if (destination.startsWith("/")) {
              return <Link href={destination}>{children}</Link>;
            }
            const external = /^https?:\/\//i.test(destination);
            return (
              <a
                href={destination}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {renderedContent}
      </ReactMarkdown>
    </article>
  );
}
