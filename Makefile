debug:
	-mkdir -p out
	NOTEMPLATE=1 node ./scripts/missing-colors.js index.html out/index.html
	cp -r node_modules/remixicon/fonts/remixicon.css node_modules/remixicon/fonts/remixicon.woff2 out/
	-rm -r tempts
	cp -r ts tempts
	./scripts/dark-variant.sh tempts
	npx esbuild --bundle base.css --outfile=out/bundle.css --external:remixicon.css --external:../fonts/hanken* --minify
	npx esbuild --target=es6 --bundle ts/main.ts --sourcemap --outfile=out/main.js --minify
	npx tailwindcss -c tailwind.config.js -i out/bundle.css -o out/bundle.css
	# For when without internet: node node_modules/tailwindcss/lib/cli.js -c tailwind.config.js -i out/bundle.css -o out/bundle.css
	cp images/src/*.svg out/
	cp -r ./static/* out/
