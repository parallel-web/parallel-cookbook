//@ts-ignore
import index from "./index.html";
export default {
  fetch: () =>
    new Response(index, {
      headers: { "Content-Type": "text/html;charset=utf8" },
    }),
};
