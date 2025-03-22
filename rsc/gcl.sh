#!/bin/bash

main ()
{
	if [ "$1" == "0" ]; then
		# frontpage
		git clone https://github.com/diegonmarcos/diegonmarcos.git profile
		git -C profile pull

		# mylib
		git clone https://github.com/diegonmarcos/mylib.git
		git -C mylib pull

		# sys
		git clone https://github.com/diegonmarcos/system.git
		git -C system pull

		# algo
		git clone https://github.com/diegonmarcos/algo.git
		git -C algo pull

		# graphic
		git clone https://github.com/diegonmarcos/graphic.git
		git -C graphic pull

	elif [ "$1" == "1" ]; then
		# frontpage
		git clone git@github.com:diegonmarcos/diegonmarcos.git profile
		git -C profile pull

		# mylib
		git clone git@github.com:diegonmarcos/mylib.git
		git -C mylib pull

		# sys
		git clone git@github.com:diegonmarcos/system.git
		git -C system pull

		# algo
		git clone git@github.com:diegonmarcos/algo.git
		git -C algo pull

		# graphic
		git clone git@github.com:diegonmarcos/graphic.git
		git -C graphic pull

		# dev
		git clone git@github.com:diegonmarcos/dev.git
		git -C dev pull

		# lecol42
		git clone git@github.com:diegonmarcos/lecole42.git
		git -C lecole42 pull

		# front
		git clone git@github.com:diegonmarcos/front.git
		git -C front pull

		# website
		git clone git@github.com:diegonmarcos/diegonmarcos.github.io.git website
		git -C website pull
	
		else
			echo "# USE"
			echo "  $0 [0 | 1]"
			echo "    0: https: public"
			echo "    1: ssh  : private"	
	fi
}

main "$@"
