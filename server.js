import * as path from "path";
import * as http from "http";
import { URL } from "url";
import * as fs from "fs/promises";
import * as esbuild from "esbuild";
import getPort from "get-port";
import { default as chalk } from "chalk";

const { bold, underline } = chalk;

async function getFiles(dir = "./", ext = [".js", ".ts"]) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    // Get files within the current directory and add a path key to the file objects
    const files = entries
        .filter(file => {
          return !file.isDirectory()
        })
        .filter((filename) => {
          return ext.includes(filename.name.slice(-3,));
        })
        .map(file => (
          dir + file.name
        ));

    // Get folders within the current directory
    const folders = entries.filter(folder => folder.isDirectory());

    for (const folder of folders)
        /*
          Add the found files within the subdirectory to the files array by calling the
          current function itself
        */
        files.push(...await getFiles(`${dir}/${folder.name}/`));

    return files;
}


export async function start({ dir, ext }) {
  const proxyPort = await getPort({ port: 2222 });
  const esbuildPort = await getPort({ port: 2221 });
  const pluginDir = path.join(process.cwd(), dir);
  const entryPoints = await getFiles(dir, ext);
  const esbuildServeConfig = {
    port: esbuildPort,
  };

  const esbuildConfig = {
    entryPoints: entryPoints,
    bundle: true,
    format: "esm",
    target: ["es2020"],
  };

  const { host, port } = await esbuild.serve(esbuildServeConfig, esbuildConfig);

  const proxyServer = http.createServer((req, res) => {
    const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);

    if (searchParams.has("dev")) {
      res.writeHead(200, {
        "content-type": "application/javascript",
        "access-control-allow-origin": "*",
      });
      res.end(templateForPathname(pathname));
      return;
    }

    const options = {
      hostname: host,
      port: port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };

    // Forward each incoming request to esbuild
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        "access-control-allow-origin": "*",
      });
      proxyRes.pipe(res, { end: true });
    });

    // Forward the body of the request to esbuild
    req.pipe(proxyReq, { end: true });
  });

  proxyServer.listen(proxyPort, () => {
    console.log(`ESBuild for ${underline(pluginDir)} on port ${underline(esbuildPort)}`);
    console.log(`Development server started on ${bold(`http://127.0.0.1:${proxyPort}/`)}`);
  });
}

function templateForPathname(pathname) {
  return `// Development plugin with auto-reload
class Plugin {
  constructor() {
    this.plugin = null;
  }
  async render(container) {
    const cacheBust = Date.now();
    const modulePath = "${pathname}?" + cacheBust;
    const { default: RevealMarket } = await import(modulePath);
    this.plugin = new RevealMarket();
    await this.plugin?.render?.(container);
  }
  draw(ctx) {
    this.plugin?.draw?.(ctx);
  }
  destroy() {
    this.plugin?.destroy?.();
  }
}
export default Plugin;
`;
}
