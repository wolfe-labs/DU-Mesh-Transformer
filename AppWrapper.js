import process from "process";

export default function app(fnMain) {
  const isDebugEnabled = !!JSON.parse(process.env.debug || 'false');
  
  return fnMain(...process.argv.slice(2))
    .then(
      (code) => process.exit(code || 0)
    )
    .catch(
      (err) => console.error(isDebugEnabled ? err : err.message) && process.exit(1)
    );
}